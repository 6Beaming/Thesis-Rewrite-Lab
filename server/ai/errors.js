import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_MESSAGES = Object.freeze({
  AI_NOT_CONFIGURED: 'AI features are not configured.',
  AI_RATE_LIMITED: 'The AI service is busy. Please try again shortly.',
  AI_TIMEOUT: 'The AI service took too long to respond. Please try again.',
  AI_INVALID_OUTPUT: 'The AI service returned an unusable response.',
  AI_PERSISTENCE_FAILED: 'The AI result could not be saved.',
  STALE_BLOCK_CONTEXT: 'This block changed before the AI request completed.',
  ANALYSIS_REQUIRED: 'Analyze this block before requesting practice feedback.',
});

export function correlationIdFromRequest(req) {
  const supplied = String(req?.get?.('x-mutation-id') ?? '');
  return UUID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function logAiStage({
  correlationId,
  stage,
  documentId,
  blockId,
  jobId = null,
  sourceTextHash = null,
  outcome = 'started',
  error = null,
}) {
  const record = {
    scope: 'ai',
    correlationId,
    stage,
    outcome,
    documentId,
    blockId,
    jobId,
    sourceTextHash,
    errorName: error instanceof Error ? error.name : undefined,
  };
  const message = JSON.stringify(record);
  if (outcome === 'failed') {
    console.error(message);
  } else {
    console.info(message);
  }
}

export function publicAiError(code, {
  statusCode = 502,
  correlationId,
  cause,
} = {}) {
  const error = new Error(SAFE_MESSAGES[code] ?? 'The AI request failed.', { cause });
  error.statusCode = statusCode;
  error.publicCode = code;
  error.correlationId = correlationId;
  return error;
}

export function mapAiError(cause, { stage, correlationId } = {}) {
  if (cause?.publicCode) {
    if (!cause.correlationId) cause.correlationId = correlationId;
    return cause;
  }
  const causeChain = [];
  let current = cause;
  while (current && causeChain.length < 5) {
    causeChain.push(current);
    current = current.cause;
  }
  const status = Number(
    causeChain.find((item) => Number(item?.statusCode ?? item?.status))?.statusCode
      ?? causeChain.find((item) => Number(item?.statusCode ?? item?.status))?.status
      ?? 0,
  );
  const name = causeChain.map((item) => String(item?.name ?? '')).join(' ');
  const message = causeChain.map((item) => String(item?.message ?? '')).join(' ');
  if (status === 429) {
    return publicAiError('AI_RATE_LIMITED', { statusCode: 429, correlationId, cause });
  }
  if (/timeout|abort/i.test(`${name} ${message}`)) {
    return publicAiError('AI_TIMEOUT', { statusCode: 504, correlationId, cause });
  }
  if (status === 503 && /not configured/i.test(message)) {
    return publicAiError('AI_NOT_CONFIGURED', { statusCode: 503, correlationId, cause });
  }
  if (stage === 'provider-parse' || /usable|invalid output/i.test(message)) {
    return publicAiError('AI_INVALID_OUTPUT', { statusCode: 502, correlationId, cause });
  }
  if (stage === 'persistence' || /database|relation|column|constraint/i.test(message)) {
    return publicAiError('AI_PERSISTENCE_FAILED', {
      statusCode: 500,
      correlationId,
      cause,
    });
  }
  return publicAiError('AI_INVALID_OUTPUT', { statusCode: 502, correlationId, cause });
}

export function safeAiMessage(code) {
  return SAFE_MESSAGES[code] ?? 'The AI request failed.';
}
