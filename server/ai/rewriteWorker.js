import { randomUUID } from 'node:crypto';
import { mapAiError, logAiStage } from './errors.js';
import { generateBlockRewriteSet } from './blockRewrites.js';
import {
  cancelRewriteJob,
  claimRewriteJobs,
  completeRewriteJob,
  failRewriteJob,
  getRewriteJobContext,
  rewriteJobContextMatches,
} from '../models/rewriteJobs.js';
import { saveBlockRewrite } from '../models/rewrites.js';

const TRANSIENT_CODES = new Set(['AI_RATE_LIMITED', 'AI_TIMEOUT']);

function publish(publisher, context, job) {
  if (!publisher || !context?.auth_user_id) return;
  publisher.publishAiJob({
    authUserId: context.auth_user_id,
    documentId: job.document_id,
    job,
  });
}

export function createRewriteWorker({
  publisher,
  concurrency = Number(process.env.AI_REWRITE_CONCURRENCY) || 2,
  intervalMs = 750,
} = {}) {
  const workerId = randomUUID();
  let timer = null;
  let running = false;

  async function processJob(job) {
    const correlationId = job.id;
    let context = null;
    try {
      logAiStage({
        correlationId,
        stage: 'context-lookup',
        documentId: job.document_id,
        blockId: job.block_id,
        jobId: job.id,
        sourceTextHash: job.source_text_hash,
      });
      context = await getRewriteJobContext(job);
      if (!rewriteJobContextMatches(job, context)) {
        const cancelled = await cancelRewriteJob(job.id);
        publish(publisher, context, cancelled);
        return;
      }
      publish(publisher, context, job);

      logAiStage({
        correlationId,
        stage: 'provider-request',
        documentId: job.document_id,
        blockId: job.block_id,
        jobId: job.id,
        sourceTextHash: job.source_text_hash,
      });
      const preferenceContext = {
        effectivePreferences: job.effective_preferences ?? {},
        warnings: job.preference_warnings ?? [],
        schemaVersion: Number(job.preference_schema_version) || 1,
        compilerVersion: job.preference_compiler_version ?? 'writing-preferences-v1',
        promptVersion: job.prompt_version,
      };
      const nlpContext = {
        fingerprint: job.nlp_supplement_fingerprint ?? 'none',
        supplement: job.compiled_nlp_supplement ?? '',
        snapshot: job.nlp_snapshot ?? {},
      };
      const generated = await generateBlockRewriteSet({
        context,
        preferenceContext,
        nlpContext,
      });
      const freshContext = await getRewriteJobContext(job);
      if (!rewriteJobContextMatches(job, freshContext)) {
        const cancelled = await cancelRewriteJob(job.id);
        publish(publisher, context, cancelled);
        return;
      }
      logAiStage({
        correlationId,
        stage: 'persistence',
        documentId: job.document_id,
        blockId: job.block_id,
        jobId: job.id,
        sourceTextHash: job.source_text_hash,
      });
      await Promise.all(generated.options.map((option) => saveBlockRewrite({
        ...(generated.preferenceResults?.[option.tone]
          ? {
              compiledPreferenceSupplement: generated.preferenceResults[option.tone].supplement,
              preferenceWarnings: [
                ...(preferenceContext.warnings ?? []),
                ...(generated.preferenceResults[option.tone].warnings ?? []),
              ],
            }
          : {}),
        documentId: job.document_id,
        blockId: job.block_id,
        sourceTextHash: job.source_text_hash,
        option,
        usage: generated.usage,
        model: job.model,
        promptVersion: job.prompt_version,
        effectivePreferences: preferenceContext.effectivePreferences,
        preferenceSchemaVersion: preferenceContext.schemaVersion,
        preferenceCompilerVersion: preferenceContext.compilerVersion,
        nlpSupplementFingerprint: nlpContext.fingerprint,
        compiledNlpSupplement: nlpContext.supplement,
        nlpSnapshot: nlpContext.snapshot,
      })));
      const completed = await completeRewriteJob(job.id);
      publish(publisher, context, completed);
    } catch (cause) {
      const mapped = mapAiError(cause, {
        stage: 'provider-request',
        correlationId,
      });
      logAiStage({
        correlationId,
        stage: 'job',
        documentId: job.document_id,
        blockId: job.block_id,
        jobId: job.id,
        sourceTextHash: job.source_text_hash,
        outcome: 'failed',
        error: cause,
      });
      const failed = await failRewriteJob(job, mapped.publicCode, {
        retry: TRANSIENT_CODES.has(mapped.publicCode) || Number(cause?.statusCode) >= 500,
      });
      publish(publisher, context, failed);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const jobs = await claimRewriteJobs({ workerId, limit: concurrency });
      await Promise.all(jobs.map(processJob));
    } catch (error) {
      console.error('Rewrite worker failed:', error instanceof Error ? error.name : 'UnknownError');
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
      void tick();
    },
    async tick() {
      await tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
