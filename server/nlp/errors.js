export const NLP_ERROR_CODES = Object.freeze({
  NOT_AVAILABLE: 'NLP_NOT_AVAILABLE',
  TIMEOUT: 'NLP_TIMEOUT',
  INVALID_OUTPUT: 'NLP_INVALID_OUTPUT',
  PIPELINE_MISMATCH: 'NLP_PIPELINE_MISMATCH',
  STALE_BLOCK_CONTEXT: 'NLP_STALE_BLOCK_CONTEXT',
  REPARTITION_CONFLICT: 'NLP_REPARTITION_CONFLICT',
  REPARTITION_FAILED: 'NLP_REPARTITION_FAILED',
  REWRITE_BLOCKED: 'REWRITE_BLOCKED_BY_NLP',
  REWRITE_CONTEXT_STALE: 'REWRITE_NLP_CONTEXT_STALE',
});

export class NlpError extends Error {
  constructor(code, message, { status = 503, cause = null, correlationId = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NlpError';
    this.code = code;
    this.publicCode = code;
    this.status = status;
    this.statusCode = status;
    this.correlationId = correlationId;
  }
}

export function safeNlpError(error, correlationId = null) {
  if (error instanceof NlpError) return error;
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
    return new NlpError(
      NLP_ERROR_CODES.TIMEOUT,
      'Automatic language review timed out.',
      { status: 504, cause: error, correlationId },
    );
  }
  return new NlpError(
    NLP_ERROR_CODES.NOT_AVAILABLE,
    'Automatic language review is temporarily unavailable.',
    { status: 503, cause: error, correlationId },
  );
}
