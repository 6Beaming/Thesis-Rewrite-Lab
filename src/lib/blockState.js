export const BLOCK_STATUSES = Object.freeze([
  'unprocessed',
  'processing',
  'processed',
  'skipped',
]);

const STATUS_SET = new Set(BLOCK_STATUSES);
const RESUMABLE_STATUS_SET = new Set(['unprocessed', 'processed', 'skipped']);
const CHANGE_SOURCES = new Set(['none', 'manual', 'ai-replacement', 'practice-replacement']);

export function normalizeBlockStatus(status) {
  return STATUS_SET.has(status) ? status : 'unprocessed';
}

export function normalizeResumeStatus(status) {
  return RESUMABLE_STATUS_SET.has(status) ? status : 'unprocessed';
}

export function normalizeChangeSource(source) {
  return CHANGE_SOURCES.has(source) ? source : 'none';
}

export function normalizeBlockState(block = {}) {
  const text = String(block.text ?? block.text_content ?? '');
  const status = normalizeBlockStatus(block.status);
  return {
    ...block,
    status,
    resumeStatus: status === 'processing'
      ? normalizeResumeStatus(block.resumeStatus ?? block.resume_status)
      : null,
    processingBaselineText: status === 'processing'
      ? String(block.processingBaselineText ?? block.processing_baseline_text ?? text)
      : null,
    changeSource: normalizeChangeSource(block.changeSource ?? block.change_source),
    partitionGeneration: Math.max(
      0,
      Number(block.partitionGeneration ?? block.partition_generation) || 0,
    ),
  };
}

export function resolveProcessingBlock(block) {
  const normalized = normalizeBlockState(block);
  if (normalized.status !== 'processing') return normalized;
  const unchanged = String(normalized.text ?? normalized.text_content ?? '')
    === normalized.processingBaselineText;
  return {
    ...normalized,
    status: unchanged ? normalized.resumeStatus : 'unprocessed',
    resumeStatus: null,
    processingBaselineText: null,
    changeSource: unchanged
      ? 'none'
      : (normalized.changeSource === 'none' ? 'manual' : normalized.changeSource),
  };
}

export function selectProcessingBlock(blocks, blockId) {
  let found = false;
  const next = blocks.map((source) => {
    const block = normalizeBlockState(source);
    if (block.id !== blockId && block.blockId !== blockId) {
      return resolveProcessingBlock(block);
    }
    if (!String(block.text ?? block.text_content ?? '').trim()) return block;
    found = true;
    if (block.status === 'processing') return block;
    return {
      ...block,
      status: 'processing',
      resumeStatus: normalizeResumeStatus(block.status),
      processingBaselineText: String(block.text ?? block.text_content ?? ''),
      changeSource: 'none',
    };
  });
  return { blocks: next, currentProcessingBlockId: found ? blockId : null };
}

export function markProcessingEdit(block, text, changeSource = 'manual') {
  const normalized = normalizeBlockState({ ...block, text });
  if (normalized.status !== 'processing') return normalized;
  const reverted = text === normalized.processingBaselineText;
  return {
    ...normalized,
    text,
    changeSource: reverted ? 'none' : normalizeChangeSource(changeSource),
  };
}

export function finishProcessingBlock(blocks, blockId, status, { advance = true } = {}) {
  if (!['processed', 'skipped'].includes(status)) {
    throw new TypeError('A block can only finish as processed or skipped.');
  }
  let targetIndex = -1;
  const resolved = blocks.map((source, index) => {
    const block = normalizeBlockState(source);
    if (block.id === blockId || block.blockId === blockId) {
      targetIndex = index;
      return {
        ...block,
        status,
        resumeStatus: null,
        processingBaselineText: null,
      };
    }
    return resolveProcessingBlock(block);
  });

  if (!advance || targetIndex < 0) {
    return { blocks: resolved, currentProcessingBlockId: null };
  }

  const following = resolved.findIndex(
    (block, index) => index > targetIndex && block.status === 'unprocessed',
  );
  const wrapped = following >= 0
    ? following
    : resolved.findIndex((block) => block.status === 'unprocessed');
  if (wrapped < 0) return { blocks: resolved, currentProcessingBlockId: null };
  const target = resolved[wrapped];
  resolved[wrapped] = {
    ...target,
    status: 'processing',
    resumeStatus: 'unprocessed',
    processingBaselineText: String(target.text ?? target.text_content ?? ''),
    changeSource: 'none',
  };
  return {
    blocks: resolved,
    currentProcessingBlockId: target.id ?? target.blockId,
  };
}

export function assertProcessingInvariant(blocks) {
  const processing = blocks.filter((block) => normalizeBlockStatus(block.status) === 'processing');
  if (processing.length > 1) {
    throw new Error('A document cannot contain more than one Processing block.');
  }
  return processing[0]?.id ?? processing[0]?.blockId ?? null;
}
