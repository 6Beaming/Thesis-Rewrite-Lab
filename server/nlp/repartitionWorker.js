import { randomUUID } from 'node:crypto';
import {
  claimDocumentNlpJobs,
  finishDocumentNlpJob,
  getNlpJobPublishContext,
  processDocumentNlpJob,
} from '../models/nlpJobs.js';
import { safeNlpError } from './errors.js';

export function createNlpRepartitionWorker({
  publisher,
  intervalMs = 1_000,
  concurrency = 1,
} = {}) {
  const workerId = randomUUID();
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const jobs = await claimDocumentNlpJobs({ workerId, limit: concurrency });
      await Promise.all(jobs.map(async (job) => {
        let completed;
        try {
          completed = await processDocumentNlpJob(job);
        } catch (error) {
          completed = await finishDocumentNlpJob(job, 'failed', safeNlpError(error).code);
        }
        const publishContext = await getNlpJobPublishContext(job);
        publisher?.publishNlpJob?.({
          authUserId: publishContext?.auth_user_id,
          documentId: job.document_id,
          job: completed,
          revision: publishContext?.revision,
          partitionRevision: publishContext?.partition_revision,
        });
      }));
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
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
