import { randomUUID } from 'node:crypto';
import { hashBlockText } from '../ai/blockAnalysis.js';
import {
  BLOCK_REWRITE_PROMPT_VERSION,
  REWRITE_TONES,
} from '../ai/blockRewrites.js';
import { query, withTransaction } from './db.js';
import { findCachedBlockRewrites } from './rewrites.js';

const ACTIVE_JOB_STATUSES = ['queued', 'running'];

export async function enqueueRewriteWindow({
  documentId,
  userId,
  blockId,
  model = process.env.OPENAI_REWRITE_MODEL || 'gpt-5.4-mini',
  promptVersion = BLOCK_REWRITE_PROMPT_VERSION,
}) {
  const candidates = await query(
    `
      with target as (
        select db.block_index
        from document_blocks db
        join documents d on d.id = db.document_id
        where db.document_id = $1
          and db.id = $2
          and d.user_id = $3
          and d.trashed = false
      )
      select db.id, db.document_id, db.text_content, db.status,
             db.resume_status, db.partition_generation, db.block_index
      from document_blocks db, target
      where db.document_id = $1
        and (
          db.id = $2
          or (db.block_index > target.block_index and db.status = 'unprocessed')
        )
        and not (db.status = 'processing' and db.resume_status = 'skipped')
      order by db.block_index
      limit 6
    `,
    [documentId, blockId, userId],
  );

  const jobs = [];
  for (const block of candidates.rows) {
    const sourceTextHash = hashBlockText(block.text_content);
    const cached = await findCachedBlockRewrites({
      documentId,
      blockId: block.id,
      sourceTextHash,
      tones: REWRITE_TONES,
      model,
      promptVersion,
    });
    if (cached.length === REWRITE_TONES.length) {
      jobs.push({
        blockId: block.id,
        sourceTextHash,
        partitionGeneration: Number(block.partition_generation),
        status: 'completed',
        cached: true,
      });
      continue;
    }

    const inserted = await query(
      `
        insert into block_rewrite_jobs (
          id, document_id, user_id, block_id, source_text_hash,
          partition_generation, requested_tones, model, prompt_version
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        on conflict (
          document_id, block_id, source_text_hash, partition_generation, model, prompt_version
        ) where status in ('queued', 'running')
        do nothing
        returning *
      `,
      [
        randomUUID(),
        documentId,
        userId,
        block.id,
        sourceTextHash,
        Number(block.partition_generation),
        JSON.stringify(REWRITE_TONES),
        model,
        promptVersion,
      ],
    );
    if (inserted.rows[0]) {
      jobs.push(inserted.rows[0]);
      continue;
    }
    const active = await query(
      `
        select *
        from block_rewrite_jobs
        where document_id = $1 and block_id = $2 and source_text_hash = $3
          and partition_generation = $4 and model = $5 and prompt_version = $6
          and status = any($7::text[])
        order by created_at desc
        limit 1
      `,
      [
        documentId,
        block.id,
        sourceTextHash,
        Number(block.partition_generation),
        model,
        promptVersion,
        ACTIVE_JOB_STATUSES,
      ],
    );
    if (active.rows[0]) jobs.push(active.rows[0]);
  }
  return jobs;
}

export async function getRewriteIdentityState({
  documentId,
  userId,
  blockId,
  sourceTextHash,
  model = process.env.OPENAI_REWRITE_MODEL || 'gpt-5.4-mini',
  promptVersion = BLOCK_REWRITE_PROMPT_VERSION,
}) {
  const owned = await query(
    `
      select db.id, db.text_content, db.partition_generation
      from document_blocks db
      join documents d on d.id = db.document_id
      where db.document_id = $1 and db.id = $2 and d.user_id = $3 and d.trashed = false
    `,
    [documentId, blockId, userId],
  );
  const block = owned.rows[0];
  if (!block) return null;
  const canonicalHash = hashBlockText(block.text_content);
  const requestedHash = sourceTextHash || canonicalHash;
  const rewrites = await findCachedBlockRewrites({
    documentId,
    blockId,
    sourceTextHash: requestedHash,
    tones: REWRITE_TONES,
    model,
    promptVersion,
  });
  const jobs = await query(
    `
      select id, block_id, source_text_hash, partition_generation, requested_tones,
             model, prompt_version, status, attempt_count, safe_error_code,
             created_at, updated_at
      from block_rewrite_jobs
      where document_id = $1 and block_id = $2 and source_text_hash = $3
        and model = $4 and prompt_version = $5
      order by created_at desc
    `,
    [documentId, blockId, requestedHash, model, promptVersion],
  );
  return {
    identity: {
      documentId,
      blockId,
      sourceTextHash: requestedHash,
      partitionGeneration: Number(block.partition_generation),
      model,
      promptVersion,
    },
    canonical: requestedHash === canonicalHash,
    rewrites,
    jobs: jobs.rows,
  };
}

export async function claimRewriteJobs({ workerId, limit }) {
  return withTransaction(async (client) => {
    const claimed = await client.query(
      `
        with candidates as (
          select id
          from block_rewrite_jobs
          where status = 'queued' and available_at <= now()
          order by created_at
          for update skip locked
          limit $1
        )
        update block_rewrite_jobs jobs
        set status = 'running',
            attempt_count = attempt_count + 1,
            lease_owner = $2,
            lease_expires_at = now() + interval '2 minutes'
        from candidates
        where jobs.id = candidates.id
        returning jobs.*
      `,
      [limit, workerId],
    );
    return claimed.rows;
  });
}

export async function getRewriteJobContext(job) {
  const result = await query(
    `
      with ordered_blocks as (
        select db.id, db.document_id, db.block_index, db.text_content,
               db.partition_generation, d.academic_style, d.user_id,
               u.auth_user_id,
               lag(db.text_content) over (order by db.block_index) as previous_text,
               lead(db.text_content) over (order by db.block_index) as next_text
        from document_blocks db
        join documents d on d.id = db.document_id
        join users u on u.id = d.user_id
        where db.document_id = $1 and d.user_id = $2 and d.trashed = false
      )
      select *
      from ordered_blocks
      where id = $3
    `,
    [job.document_id, job.user_id, job.block_id],
  );
  return result.rows[0] ?? null;
}

export function rewriteJobContextMatches(job, context) {
  return Boolean(
    context
    && hashBlockText(context.text_content) === job.source_text_hash
    && Number(context.partition_generation) === Number(job.partition_generation)
  );
}

export async function completeRewriteJob(jobId) {
  const result = await query(
    `
      update block_rewrite_jobs
      set status = 'completed', safe_error_code = null,
          lease_owner = null, lease_expires_at = null
      where id = $1
      returning *
    `,
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function cancelRewriteJob(jobId, code = 'STALE_BLOCK_CONTEXT') {
  const result = await query(
    `
      update block_rewrite_jobs
      set status = 'cancelled', safe_error_code = $2,
          lease_owner = null, lease_expires_at = null
      where id = $1
      returning *
    `,
    [jobId, code],
  );
  return result.rows[0] ?? null;
}

export async function failRewriteJob(job, code, { retry = false } = {}) {
  const retryDelaySeconds = Math.min(60, 2 ** Math.max(1, Number(job.attempt_count)));
  const shouldRetry = retry && Number(job.attempt_count) < 3;
  const result = await query(
    `
      update block_rewrite_jobs
      set status = $2,
          safe_error_code = $3,
          available_at = case when $2 = 'queued'
            then now() + ($4::text || ' seconds')::interval
            else available_at
          end,
          lease_owner = null,
          lease_expires_at = null
      where id = $1
      returning *
    `,
    [job.id, shouldRetry ? 'queued' : 'failed', code, retryDelaySeconds],
  );
  return result.rows[0] ?? null;
}
