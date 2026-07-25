export function rewriteIdentityMatchesVisible(responseIdentity, visibleIdentity, requestKey, visibleKey) {
  return Boolean(
    responseIdentity
    && visibleIdentity
    && requestKey === visibleKey
    && visibleIdentity.documentId === responseIdentity.documentId
    && visibleIdentity.blockId === responseIdentity.blockId
    && Number(visibleIdentity.partitionGeneration) === Number(responseIdentity.partitionGeneration),
  );
}

export function cacheRewriteResponse(cache, response) {
  const next = { ...cache };
  for (const option of response?.rewrites ?? []) {
    next[`${response.identity?.sourceTextHash}|${option.tone}`] = option;
  }
  return next;
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
