import { randomUUID } from 'node:crypto';
import {
  AnalyzeBlockResultSchema,
  PartitionDocumentResultSchema,
} from './contracts.js';
import {
  CURRENT_NLP_PIPELINE_VERSION,
  environmentFlag,
  nlpVersionInfo,
} from './config.js';
import { NlpError, NLP_ERROR_CODES, safeNlpError } from './errors.js';
import { hashNlpText } from './hash.js';
import {
  analyzeBlockLocally,
  partitionDocumentLocally,
} from './localPipeline.js';

const activeBlockRequests = new Map();
const activePartitionRequests = new Map();

function nlpServiceUrl() {
  return String(process.env.NLP_SERVICE_URL ?? '').replace(/\/+$/u, '');
}

function timeoutMs(kind) {
  const configured = Number(
    kind === 'health'
      ? process.env.NLP_HEALTH_TIMEOUT_MS
      : kind === 'partition'
        ? process.env.NLP_PARTITION_TIMEOUT_MS
        : process.env.NLP_BLOCK_TIMEOUT_MS,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return kind === 'health' ? 1_500 : kind === 'partition' ? 45_000 : 8_000;
}

async function requestNlp(path, payload, { kind, correlationId }) {
  const baseUrl = nlpServiceUrl();
  if (!baseUrl) {
    throw new NlpError(
      NLP_ERROR_CODES.NOT_AVAILABLE,
      'Automatic language review is not configured.',
      { correlationId },
    );
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: payload === null ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      ...(payload === null ? {} : { 'Content-Type': 'application/json' }),
      'X-Correlation-Id': correlationId,
    },
    ...(payload === null ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(timeoutMs(kind)),
  });
  if (!response.ok) {
    throw new NlpError(
      response.status === 504 ? NLP_ERROR_CODES.TIMEOUT : NLP_ERROR_CODES.NOT_AVAILABLE,
      'Automatic language review could not complete the request.',
      { status: response.status >= 400 && response.status < 600 ? response.status : 503, correlationId },
    );
  }
  return response.json();
}

function assertCurrentResult(result, expectedHash, correlationId) {
  if (result.pipelineVersion !== CURRENT_NLP_PIPELINE_VERSION) {
    throw new NlpError(
      NLP_ERROR_CODES.PIPELINE_MISMATCH,
      'Automatic language review needs to be refreshed.',
      { status: 409, correlationId },
    );
  }
  if (expectedHash && result.textHash !== expectedHash) {
    throw new NlpError(
      NLP_ERROR_CODES.INVALID_OUTPUT,
      'The writing block changed during automatic review.',
      { status: 502, correlationId },
    );
  }
  return result;
}

function withDeduplication(map, key, operation) {
  if (map.has(key)) return map.get(key);
  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (map.get(key) === promise) map.delete(key);
    });
  map.set(key, promise);
  return promise;
}

export async function getNlpHealth({ correlationId = randomUUID() } = {}) {
  if (!environmentFlag('NLP_SERVICE_ENABLED', true)) {
    return {
      status: 'disabled',
      ...nlpVersionInfo(),
      correlationId,
      source: 'disabled',
    };
  }
  try {
    const result = await requestNlp('/health', null, { kind: 'health', correlationId });
    if (result.pipelineVersion !== CURRENT_NLP_PIPELINE_VERSION) {
      throw new NlpError(
        NLP_ERROR_CODES.PIPELINE_MISMATCH,
        'Automatic language review needs to be refreshed.',
        { status: 409, correlationId },
      );
    }
    return { ...result, correlationId, source: 'remote' };
  } catch (error) {
    if (!environmentFlag('NLP_FAIL_OPEN', true)) throw safeNlpError(error, correlationId);
    return {
      status: 'degraded',
      ...nlpVersionInfo(),
      correlationId,
      source: 'local-fallback',
      errorCode: safeNlpError(error, correlationId).code,
    };
  }
}

export async function analyzeTemporaryBlock({
  text,
  sourceType = 'paragraph',
  locale = 'en',
  knownTerms = [],
  requestId = randomUUID(),
  correlationId = requestId,
} = {}) {
  const source = String(text ?? '');
  const textHash = hashNlpText(source);
  const key = [
    textHash,
    sourceType,
    locale,
    [...knownTerms].sort().join(','),
    CURRENT_NLP_PIPELINE_VERSION,
  ].join('|');
  return withDeduplication(activeBlockRequests, key, async () => {
    if (!environmentFlag('NLP_SERVICE_ENABLED', true)) {
      return {
        ...analyzeBlockLocally({
          text: source,
          sourceType,
          knownTerms,
          degraded: true,
        }),
        correlationId,
        source: 'local-fallback',
      };
    }
    try {
      const raw = await requestNlp('/v1/analyze-block', {
        text: source,
        sourceType,
        locale,
        knownTerms,
        requestId,
      }, { kind: 'block', correlationId });
      const parsed = AnalyzeBlockResultSchema.parse(raw);
      return {
        ...assertCurrentResult(parsed, textHash, correlationId),
        correlationId,
        source: 'remote',
      };
    } catch (error) {
      if (!environmentFlag('NLP_FAIL_OPEN', true)) throw safeNlpError(error, correlationId);
      return {
        ...analyzeBlockLocally({
          text: source,
          sourceType,
          knownTerms,
          degraded: true,
        }),
        correlationId,
        source: 'local-fallback',
      };
    }
  });
}

export async function partitionStructuralContent({
  structuralBlocks,
  semanticProfile = 'medium',
  locale = 'en',
  requestId = randomUUID(),
  correlationId = requestId,
} = {}) {
  const sourceFingerprint = hashNlpText(JSON.stringify(
    (structuralBlocks ?? []).map((block) => ({
      text: block?.text ?? block?.textContent ?? '',
      sourceType: block?.sourceType ?? block?.attrs?.sourceType ?? 'paragraph',
      level: block?.level ?? block?.attrs?.level ?? null,
    })),
  ));
  const key = [
    sourceFingerprint,
    semanticProfile,
    locale,
    CURRENT_NLP_PIPELINE_VERSION,
  ].join('|');
  return withDeduplication(activePartitionRequests, key, async () => {
    if (!environmentFlag('NLP_SERVICE_ENABLED', true)) {
      return {
        ...partitionDocumentLocally({
          structuralBlocks,
          semanticProfile,
          degraded: true,
        }),
        correlationId,
        source: 'local-fallback',
      };
    }
    try {
      const raw = await requestNlp('/v1/partition-document', {
        structuralBlocks,
        semanticProfile,
        locale,
        pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
        requestId,
      }, { kind: 'partition', correlationId });
      const parsed = PartitionDocumentResultSchema.parse(raw);
      if (parsed.pipelineVersion !== CURRENT_NLP_PIPELINE_VERSION) {
        throw new NlpError(
          NLP_ERROR_CODES.PIPELINE_MISMATCH,
          'Automatic language review needs to be refreshed.',
          { status: 409, correlationId },
        );
      }
      return { ...parsed, correlationId, source: 'remote' };
    } catch (error) {
      if (!environmentFlag('NLP_FAIL_OPEN', true)) throw safeNlpError(error, correlationId);
      return {
        ...partitionDocumentLocally({
          structuralBlocks,
          semanticProfile,
          degraded: true,
        }),
        correlationId,
        source: 'local-fallback',
      };
    }
  });
}
