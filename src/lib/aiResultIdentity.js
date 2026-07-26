import { writingPreferenceCacheKey } from '../shared/writingPreferences.js';

export function rewriteIdentityMatchesVisible(responseIdentity, visibleIdentity, requestKey, visibleKey) {
  return Boolean(
    responseIdentity
    && visibleIdentity
    && requestKey === visibleKey
    && visibleIdentity.documentId === responseIdentity.documentId
    && visibleIdentity.blockId === responseIdentity.blockId
    && Number(visibleIdentity.partitionGeneration) === Number(responseIdentity.partitionGeneration)
    && (visibleIdentity.nlpSnapshotFingerprint ?? 'none')
      === (responseIdentity.nlpSnapshotFingerprint ?? 'none'),
  );
}

export function cacheRewriteResponse(cache, response) {
  const next = { ...cache };
  const preferenceKey = writingPreferenceCacheKey(
    response?.identity?.effectivePreferences,
  );
  const nlpFingerprint = response?.identity?.nlpSnapshotFingerprint ?? 'none';
  for (const option of response?.rewrites ?? []) {
    next[
      `${response.identity?.blockId}|${response.identity?.sourceTextHash}|${preferenceKey}|${nlpFingerprint}|${option.tone}`
    ] = option;
  }
  return next;
}

export function clearBlockAiCaches({
  rewriteCache,
  blockAnalyses,
  practiceCache,
  documentId,
  blockId,
}) {
  const rewritePrefix = `${blockId}|`;
  const analysisPrefix = `${blockId}|`;
  const practicePrefix = `${documentId}|${blockId}|`;
  return {
    rewriteCache: Object.fromEntries(Object.entries(rewriteCache ?? {}).filter(
      ([key, value]) => !key.startsWith(rewritePrefix) && value?.blockId !== blockId,
    )),
    blockAnalyses: Object.fromEntries(Object.entries(blockAnalyses ?? {}).filter(
      ([key]) => !key.startsWith(analysisPrefix),
    )),
    practiceCache: Object.fromEntries(Object.entries(practiceCache ?? {}).filter(
      ([key, value]) => (
        !key.startsWith(practicePrefix)
        && value?.identity?.blockId !== blockId
      ),
    )),
  };
}

export function activeBlockInfoFromDraft(
  draft,
  preferredBlockId = null,
  fallbackStatus = 'unprocessed',
) {
  const blockId = preferredBlockId ?? draft?.currentProcessingBlockId ?? null;
  const block = draft?.blocks?.find((item) => item.id === blockId) ?? null;
  if (!blockId || !block) {
    return { blockId: null, status: fallbackStatus };
  }
  return {
    blockId,
    status: block.status ?? fallbackStatus,
    originalStatus: block.status ?? fallbackStatus,
    text: block.text ?? block.text_content ?? '',
    sourceTextHash: null,
    partitionGeneration: Number(
      block.partition_generation ?? block.attrs?.partitionGeneration ?? 0,
    ),
  };
}

export function cachePracticeResponse(cache, requestKey, serverKey, feedback) {
  return {
    ...cache,
    [serverKey]: feedback,
    [requestKey]: feedback,
  };
}

export async function hashAiSourceText(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
}
