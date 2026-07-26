import { randomUUID } from 'node:crypto';
import { query, withTransaction } from './db.js';
import {
  createBlockRecords,
  createContentJson,
  getDocumentNlpSummary,
  insertBlocks,
  recalculateDocumentProgress,
} from './blocks.js';
import { appendDocumentVersion } from './versions.js';
import { partitionStructuralContent } from '../nlp/client.js';
import {
  mapRepartitionedBlockIdentities,
  summarizeIdentityMapping,
} from '../nlp/blockIdentityMapping.js';
import {
  CURRENT_NLP_PIPELINE_VERSION,
  normalizeSemanticProfile,
} from '../nlp/config.js';
import { countCodePoints, sliceCodePoints } from '../nlp/hash.js';
import { NLP_ERROR_CODES } from '../nlp/errors.js';

function sliceInlineContent(content = [], startCp, endCp) {
  const result = [];
  let offsetCp = 0;
  for (const node of content) {
    const text = node.type === 'hardBreak' ? '\n' : String(node.text ?? '');
    const nodeEndCp = offsetCp + countCodePoints(text);
    const sliceStart = Math.max(startCp, offsetCp);
    const sliceEnd = Math.min(endCp, nodeEndCp);
    if (sliceStart < sliceEnd) {
      result.push(node.type === 'hardBreak'
        ? { ...node }
        : {
          ...node,
          text: sliceCodePoints(text, sliceStart - offsetCp, sliceEnd - offsetCp),
        });
    }
    offsetCp = nodeEndCp;
  }
  return result.filter((node) => node.type === 'hardBreak' || node.text);
}

function structuralBlocksFromRows(blocks) {
  const groups = [];
  for (const block of blocks) {
    const paragraphIndex = Number(block.attrs?.paragraphIndex ?? block.block_index);
    let group = groups.find((item) => item.paragraphIndex === paragraphIndex);
    if (!group) {
      group = {
        paragraphIndex,
        text: '',
        content: [],
        sourceType: block.attrs?.sourceType ?? 'paragraph',
        level: block.attrs?.level ?? null,
        attrs: block.attrs ?? {},
      };
      groups.push(group);
    }
    group.text += block.text_content;
    group.content.push(...(block.tiptap_node?.content ?? [{ type: 'text', text: block.text_content }]));
  }
  return groups.sort((left, right) => left.paragraphIndex - right.paragraphIndex);
}

function applyMappedIdentity(records, mapped) {
  let processingAssigned = false;
  records.forEach((record, index) => {
    const mapping = mapped[index];
    const candidate = mapping.candidate;
    const primary = mapping.primary;
    if (mapping.preserveId) record.id = mapping.preserveId;
    record.partitionGeneration = mapping.partitionGeneration;
    let status = candidate.initialStatus === 'skipped' ? 'skipped' : 'unprocessed';
    if (
      status !== 'skipped'
      && !mapping.boundaryChanged
      && primary?.status === 'processed'
    ) status = 'processed';
    if (
      status !== 'skipped'
      && !processingAssigned
      && mapping.overlapping.some((block) => block.status === 'processing')
      && ['pass', 'warning'].includes(candidate.nlpStatus)
    ) {
      status = 'processing';
      processingAssigned = true;
    }
    record.status = status;
    record.resumeStatus = status === 'processing' ? 'unprocessed' : null;
    record.processingBaselineText = status === 'processing' ? record.textContent : null;
    record.attrs = {
      ...record.attrs,
      blockId: record.id,
      status,
      resumeStatus: record.resumeStatus,
      processingBaselineText: record.processingBaselineText,
      partitionGeneration: record.partitionGeneration,
    };
    record.tiptapNode = { ...record.tiptapNode, attrs: record.attrs };
  });
  if (!processingAssigned) {
    const next = records.find((record) => (
      record.status === 'unprocessed'
      && ['pass', 'warning'].includes(record.nlpStatus)
    ));
    if (next) {
      next.status = 'processing';
      next.resumeStatus = 'unprocessed';
      next.processingBaselineText = next.textContent;
      next.attrs.status = next.status;
      next.attrs.resumeStatus = next.resumeStatus;
      next.attrs.processingBaselineText = next.processingBaselineText;
      next.tiptapNode.attrs = next.attrs;
    }
  }
}

export async function enqueueDocumentNlpJob({
  documentId,
  userId,
  semanticProfile,
  expectedRevision = null,
  operation = 'repartition',
  correlationId = randomUUID(),
}) {
  const profile = normalizeSemanticProfile(semanticProfile);
  return withTransaction(async (client) => {
    const owned = await client.query(
      `select id, revision, partition_revision
       from documents
       where id = $1 and user_id = $2 and trashed = false
       for update`,
      [documentId, userId],
    );
    if (!owned.rows[0]) return null;
    if (
      expectedRevision !== null
      && Number(expectedRevision) !== Number(owned.rows[0].revision)
    ) {
      const error = new Error('The document changed before repartitioning could start.');
      error.statusCode = 409;
      error.publicCode = NLP_ERROR_CODES.REPARTITION_CONFLICT;
      throw error;
    }
    const existing = await client.query(
      `select * from document_nlp_jobs
       where document_id = $1 and status in ('queued', 'running')
       order by created_at desc limit 1`,
      [documentId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const job = await client.query(
      `insert into document_nlp_jobs (
         user_id, document_id, requested_revision, requested_partition_revision,
         requested_profile, pipeline_version, operation, correlation_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        userId,
        documentId,
        Number(owned.rows[0].revision),
        Number(owned.rows[0].partition_revision),
        profile,
        CURRENT_NLP_PIPELINE_VERSION,
        operation,
        correlationId,
      ],
    );
    await client.query(
      `update documents set nlp_status = 'processing' where id = $1`,
      [documentId],
    );
    return job.rows[0];
  });
}

export async function getDocumentNlpJob({ documentId, jobId, userId }) {
  const result = await query(
    `select jobs.*
     from document_nlp_jobs jobs
     join documents d on d.id = jobs.document_id
     where jobs.id = $1 and jobs.document_id = $2 and d.user_id = $3`,
    [jobId, documentId, userId],
  );
  return result.rows[0] ?? null;
}

export async function getLatestDocumentNlpJob({ documentId, userId }) {
  const result = await query(
    `select jobs.*, d.nlp_status as document_nlp_status,
            d.nlp_document_snapshot, d.revision, d.partition_revision
     from document_nlp_jobs jobs
     join documents d on d.id = jobs.document_id
     where jobs.document_id = $1 and d.user_id = $2
     order by jobs.created_at desc
     limit 1`,
    [documentId, userId],
  );
  return result.rows[0] ?? null;
}

export async function getNlpJobPublishContext(job) {
  const result = await query(
    `select u.auth_user_id, d.revision, d.partition_revision
     from documents d
     join users u on u.id = d.user_id
     where d.id = $1 and d.user_id = $2`,
    [job.document_id, job.user_id],
  );
  return result.rows[0] ?? null;
}

export async function claimDocumentNlpJobs({ workerId, limit = 1 }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `with candidates as (
         select id from document_nlp_jobs
         where status = 'queued' and available_at <= now()
         order by created_at
         for update skip locked
         limit $1
       )
       update document_nlp_jobs jobs
       set status = 'running', attempt_count = attempt_count + 1,
           locked_at = now(), lease_owner = $2,
           lease_expires_at = now() + interval '2 minutes'
       from candidates
       where jobs.id = candidates.id
       returning jobs.*`,
      [limit, workerId],
    );
    return result.rows;
  });
}

export async function processDocumentNlpJob(job) {
  const source = await query(
    `select d.id, d.revision, d.partition_revision, d.style_settings,
            u.auth_user_id
     from documents d
     join users u on u.id = d.user_id
     where d.id = $1 and d.user_id = $2 and d.trashed = false`,
    [job.document_id, job.user_id],
  );
  if (
    !source.rows[0]
    || Number(source.rows[0].revision) !== Number(job.requested_revision)
    || Number(source.rows[0].partition_revision) !== Number(job.requested_partition_revision)
  ) {
    return finishDocumentNlpJob(job, 'cancelled', NLP_ERROR_CODES.REPARTITION_CONFLICT);
  }
  const blockResult = await query(
    `select * from document_blocks where document_id = $1 order by block_index`,
    [job.document_id],
  );
  const structural = structuralBlocksFromRows(blockResult.rows);
  const partition = await partitionStructuralContent({
    structuralBlocks: structural.map((block) => ({
      text: block.text,
      sourceType: block.sourceType,
      level: block.level,
    })),
    semanticProfile: job.requested_profile,
    correlationId: job.correlation_id,
  });
  for (const block of structural) {
    const reconstructed = partition.candidates
      .filter((candidate) => candidate.paragraphIndex === block.paragraphIndex)
      .map((candidate) => candidate.text)
      .join('');
    if (reconstructed !== block.text) {
      return finishDocumentNlpJob(job, 'failed', NLP_ERROR_CODES.INVALID_OUTPUT);
    }
  }
  const inputs = partition.candidates.map((candidate) => {
    const sourceBlock = structural[candidate.paragraphIndex];
    return {
      text: candidate.text,
      content: sliceInlineContent(sourceBlock.content, candidate.startCp, candidate.endCp),
      attrs: {
        ...sourceBlock.attrs,
        paragraphIndex: candidate.paragraphIndex,
        sourceType: candidate.sourceType,
        level: candidate.level,
        semanticProfile: partition.semanticProfile,
      },
      initialStatus: candidate.initialStatus,
      nlp: candidate.nlpAnalysis,
    };
  });
  const records = createBlockRecords(inputs, source.rows[0].style_settings ?? {});
  const mapped = mapRepartitionedBlockIdentities(blockResult.rows, partition.candidates);
  applyMappedIdentity(records, mapped);

  return withTransaction(async (client) => {
    const locked = await client.query(
      `select revision, partition_revision
       from documents where id = $1 and user_id = $2 and trashed = false
       for update`,
      [job.document_id, job.user_id],
    );
    if (
      !locked.rows[0]
      || Number(locked.rows[0].revision) !== Number(job.requested_revision)
      || Number(locked.rows[0].partition_revision) !== Number(job.requested_partition_revision)
    ) {
      return finishDocumentNlpJob(job, 'cancelled', NLP_ERROR_CODES.REPARTITION_CONFLICT, client);
    }
    const beforeVersion = await appendDocumentVersion(
      client,
      job.document_id,
      `Before semantic repartition (${job.requested_profile})`,
    );
    await client.query('delete from document_blocks where document_id = $1', [job.document_id]);
    await insertBlocks(client, job.document_id, records);
    await recalculateDocumentProgress(client, job.document_id);
    const contentJson = createContentJson(records);
    const current = records.find((record) => record.status === 'processing') ?? null;
    const summary = {
      ...await getDocumentNlpSummary(job.document_id, client.query.bind(client)),
      ...summarizeIdentityMapping(mapped),
      degraded: Boolean(partition.degraded),
      warnings: partition.warnings ?? [],
      beforeVersionId: beforeVersion.id,
    };
    const updated = await client.query(
      `update documents
       set content_json = $2::jsonb,
           current_processing_block_id = $3,
           nlp_semantic_profile = $4,
           nlp_status = $5,
           nlp_pipeline_version = $6,
           nlp_document_snapshot = $7::jsonb,
           partition_revision = partition_revision + 1,
           revision = revision + 1
       where id = $1
       returning revision, partition_revision`,
      [
        job.document_id,
        JSON.stringify(contentJson),
        current?.id ?? null,
        job.requested_profile,
        partition.degraded ? 'degraded' : 'ready',
        CURRENT_NLP_PIPELINE_VERSION,
        JSON.stringify(summary),
      ],
    );
    const afterVersion = await appendDocumentVersion(
      client,
      job.document_id,
      `After semantic repartition (${job.requested_profile})`,
    );
    summary.afterVersionId = afterVersion.id;
    summary.revision = Number(updated.rows[0].revision);
    summary.partitionRevision = Number(updated.rows[0].partition_revision);
    await client.query(
      `update documents set nlp_document_snapshot = $2::jsonb where id = $1`,
      [job.document_id, JSON.stringify(summary)],
    );
    return finishDocumentNlpJob(job, 'completed', null, client, summary);
  });
}

export async function finishDocumentNlpJob(job, status, code = null, client = null, summary = {}) {
  const run = client?.query.bind(client) ?? query;
  const result = await run(
    `update document_nlp_jobs
     set status = $2, safe_error_code = $3, summary_json = $4::jsonb,
         lease_owner = null, lease_expires_at = null
     where id = $1
     returning *`,
    [job.id, status, code, JSON.stringify(summary)],
  );
  if (status === 'failed' || status === 'cancelled') {
    await run(
      `update documents
       set nlp_status = case when $2 = 'failed' then 'failed' else 'pending' end
       where id = $1`,
      [job.document_id, status],
    );
  }
  return result.rows[0] ?? null;
}
