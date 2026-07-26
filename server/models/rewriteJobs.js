import { randomUUID } from 'node:crypto';
import { hashBlockText } from '../ai/blockAnalysis.js';
import {
  BLOCK_REWRITE_PROMPT_VERSION,
  createRewritePreferenceContext,
  REWRITE_TONES,
} from '../ai/blockRewrites.js';
import { query, withTransaction } from './db.js';
import { findCachedBlockRewrites } from './rewrites.js';
import {
  compileNlpRewriteSupplement,
  nlpAwareRewritePromptVersion,
} from '../ai/nlpPromptSupplement.js';
import {
  isRewriteEligibleBlock,
  normalizePersistedBlockNlp,
} from '../nlp/blockAggregation.js';
import { analyzeTemporaryBlock } from '../nlp/client.js';
import { saveBlockNlpResult } from './blocks.js';
import { environmentFlag } from '../nlp/config.js';

const ACTIVE_JOB_STATUSES = ['queued', 'running'];
export const DEFAULT_REWRITE_PREWARM_LIMIT = 6;
export const PREFERENCE_REWRITE_PREWARM_LIMIT = 3;

export function rewritePrewarmLimit(preferenceContext) {
  return Object.keys(preferenceContext?.effectivePreferences ?? {}).length
    ? PREFERENCE_REWRITE_PREWARM_LIMIT
    : DEFAULT_REWRITE_PREWARM_LIMIT;
}

function legacyRewriteEligible(block) {
  return Boolean(
    ['processing', 'unprocessed'].includes(block?.status)
    && !(block.status === 'processing' && block.resume_status === 'skipped'),
  );
}

function rewriteEligible(block) {
  return environmentFlag('NLP_REWRITE_GATE_ENABLED', true)
    ? isRewriteEligibleBlock(block)
    : legacyRewriteEligible(block);
}

function rewriteNlpContext(block) {
  return environmentFlag('NLP_REWRITE_GATE_ENABLED', true)
    ? compileNlpRewriteSupplement(block)
    : compileNlpRewriteSupplement({});
}

export async function enqueueRewriteWindow({
  documentId,
  userId,
  blockId,
  model = process.env.OPENAI_REWRITE_MODEL || 'gpt-5.4-mini',
  preferenceContext = createRewritePreferenceContext(),
  promptVersion = preferenceContext.promptVersion ?? BLOCK_REWRITE_PROMPT_VERSION,
  candidateLimit = rewritePrewarmLimit(preferenceContext),
  maxScan = 20,
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
             db.resume_status, db.partition_generation, db.block_index,
             db.attrs, db.nlp_status, db.nlp_reason_codes, db.nlp_analysis,
             db.nlp_text_hash, db.nlp_pipeline_version,
             db.nlp_snapshot_fingerprint, db.semantic_coherence,
             db.semantic_anchor, db.nlp_checked_at
      from document_blocks db, target
      where db.document_id = $1
        and (
          db.id = $2
          or db.block_index > target.block_index
        )
      order by db.block_index
      limit $4
    `,
    [documentId, blockId, userId, maxScan],
  );

  const jobs = [];
  for (const originalBlock of candidates.rows) {
    if (jobs.length >= candidateLimit) break;
    let block = originalBlock;
    if (
      ['processing', 'unprocessed'].includes(block.status)
      && block.status !== 'skipped'
      && !rewriteEligible(block)
      && block.nlp_status === 'unknown'
      && environmentFlag('NLP_REWRITE_GATE_ENABLED', true)
    ) {
      try {
        const refreshed = await analyzeTemporaryBlock({
          text: block.text_content,
          sourceType: block.attrs?.sourceType ?? 'paragraph',
          requestId: randomUUID(),
        });
        const saved = await saveBlockNlpResult({
          documentId,
          blockId: block.id,
          userId,
          expectedTextHash: hashBlockText(block.text_content),
          expectedPartitionGeneration: Number(block.partition_generation),
          result: refreshed,
        });
        if (saved.block) block = saved.block;
      } catch (error) {
        console.warn(JSON.stringify({
          scope: 'rewrite-prewarm-nlp',
          documentId,
          blockId: block.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: error?.publicCode ?? error?.code ?? null,
        }));
        continue;
      }
    }
    if (!rewriteEligible(block)) continue;
    const sourceTextHash = hashBlockText(block.text_content);
    const nlpContext = rewriteNlpContext(block);
    const effectivePromptVersion = nlpAwareRewritePromptVersion(promptVersion, nlpContext);
    const cached = await findCachedBlockRewrites({
      documentId,
      blockId: block.id,
      sourceTextHash,
      tones: REWRITE_TONES,
      model,
      promptVersion: effectivePromptVersion,
      nlpSupplementFingerprint: nlpContext.fingerprint,
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
          partition_generation, requested_tones, model, prompt_version,
          effective_preferences, preference_warnings,
          preference_schema_version, preference_compiler_version,
          nlp_supplement_fingerprint, compiled_nlp_supplement, nlp_snapshot
        )
        values (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
          $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb
        )
        on conflict (
          document_id, block_id, source_text_hash, partition_generation, model,
          prompt_version, nlp_supplement_fingerprint
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
        effectivePromptVersion,
        JSON.stringify(preferenceContext.effectivePreferences ?? {}),
        JSON.stringify(preferenceContext.warnings ?? []),
        preferenceContext.schemaVersion ?? 1,
        preferenceContext.compilerVersion ?? 'writing-preferences-v1',
        nlpContext.fingerprint,
        nlpContext.supplement,
        JSON.stringify(nlpContext.snapshot),
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
          and nlp_supplement_fingerprint = $7
          and status = any($8::text[])
        order by created_at desc
        limit 1
      `,
      [
        documentId,
        block.id,
        sourceTextHash,
        Number(block.partition_generation),
        model,
        effectivePromptVersion,
        nlpContext.fingerprint,
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
  preferenceContext = createRewritePreferenceContext(),
  promptVersion = preferenceContext.promptVersion ?? BLOCK_REWRITE_PROMPT_VERSION,
}) {
  const owned = await query(
    `
      select db.id, db.text_content, db.status, db.resume_status,
             db.partition_generation, db.attrs, db.nlp_status,
             db.nlp_reason_codes, db.nlp_analysis, db.nlp_text_hash,
             db.nlp_pipeline_version, db.nlp_snapshot_fingerprint,
             db.semantic_coherence, db.semantic_anchor, db.nlp_checked_at
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
  const eligible = rewriteEligible(block);
  const nlpContext = eligible
    ? rewriteNlpContext(block)
    : compileNlpRewriteSupplement({});
  const effectivePromptVersion = nlpAwareRewritePromptVersion(promptVersion, nlpContext);
  const rewrites = await findCachedBlockRewrites({
    documentId,
    blockId,
    sourceTextHash: requestedHash,
    tones: REWRITE_TONES,
    model,
    promptVersion: effectivePromptVersion,
    nlpSupplementFingerprint: nlpContext.fingerprint,
  });
  const jobs = await query(
    `
      select id, block_id, source_text_hash, partition_generation, requested_tones,
             model, prompt_version, status, attempt_count, safe_error_code,
             created_at, updated_at
      from block_rewrite_jobs
      where document_id = $1 and block_id = $2 and source_text_hash = $3
        and model = $4 and prompt_version = $5
        and nlp_supplement_fingerprint = $6
      order by created_at desc
    `,
    [
      documentId,
      blockId,
      requestedHash,
      model,
      effectivePromptVersion,
      nlpContext.fingerprint,
    ],
  );
  return {
    identity: {
      documentId,
      blockId,
      sourceTextHash: requestedHash,
      partitionGeneration: Number(block.partition_generation),
      model,
      promptVersion: effectivePromptVersion,
      nlpSupplementFingerprint: nlpContext.fingerprint,
      nlpSnapshotFingerprint: normalizePersistedBlockNlp(block).nlpSnapshotFingerprint,
      nlpStatus: normalizePersistedBlockNlp(block).nlpStatus,
      rewriteEligible: eligible,
      effectivePreferences: preferenceContext.effectivePreferences ?? {},
      preferenceSchemaVersion: preferenceContext.schemaVersion ?? 1,
      preferenceCompilerVersion: preferenceContext.compilerVersion
        ?? 'writing-preferences-v1',
      preferenceWarnings: preferenceContext.warnings ?? [],
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
               db.status, db.resume_status, db.partition_generation,
               db.attrs, db.nlp_status, db.nlp_reason_codes, db.nlp_analysis,
               db.nlp_text_hash, db.nlp_pipeline_version,
               db.nlp_snapshot_fingerprint, db.semantic_coherence,
               db.semantic_anchor, db.nlp_checked_at,
               d.academic_style, d.user_id,
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
  const supplement = context && rewriteEligible(context)
    ? rewriteNlpContext(context)
    : null;
  return Boolean(
    context
    && hashBlockText(context.text_content) === job.source_text_hash
    && Number(context.partition_generation) === Number(job.partition_generation)
    && supplement
    && supplement.fingerprint === (job.nlp_supplement_fingerprint ?? 'none')
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
