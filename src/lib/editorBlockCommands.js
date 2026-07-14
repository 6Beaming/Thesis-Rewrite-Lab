import { splitBlockKeepMarks } from '@tiptap/pm/commands';

const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);
const UNFINISHED_BLOCK_STATUSES = new Set(['unprocessed', 'processing']);

function textFromJsonNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromJsonNode).join('');
}

function structuralContainerAttrs(attrs = {}) {
  const {
    blockId: _blockId,
    status: _status,
    length: _length,
    paragraphIndex: _paragraphIndex,
    ...containerAttrs
  } = attrs;
  return containerAttrs;
}

function legacyBlockSegmentAttrs(attrs = {}) {
  return {
    ...(attrs.lineHeight ? { lineHeight: attrs.lineHeight } : {}),
    ...(attrs.textIndent ? { textIndent: attrs.textIndent } : {}),
    ...(attrs.textAlign ? { textAlign: attrs.textAlign } : {}),
    ...(attrs.fontFamily ? { fontFamily: attrs.fontFamily } : {}),
    ...(attrs.fontSize ? { fontSize: attrs.fontSize } : {}),
    ...(attrs.blockId ? { blockId: attrs.blockId } : {}),
    ...(attrs.status ? { status: attrs.status } : {}),
    ...(Number.isInteger(attrs.paragraphIndex) ? { paragraphIndex: attrs.paragraphIndex } : {}),
  };
}

export function convertLegacyTrackedBlocks(
  contentJson,
  createBlockId = (index) => `block-${index + 1}`,
) {
  let blockIndex = 0;
  let structuralIndex = 0;

  function normalizeBlockSegment(node, paragraphIndex, inheritedAttrs = {}) {
    const text = textFromJsonNode(node);
    const existingAttrs = { ...inheritedAttrs, ...(node.attrs ?? {}) };
    const currentBlockIndex = blockIndex;
    blockIndex += 1;

    return {
      ...node,
      type: 'blockSegment',
      attrs: {
        ...existingAttrs,
        blockId: existingAttrs.blockId || createBlockId(currentBlockIndex),
        status: BLOCK_STATUSES.has(existingAttrs.status) ? existingAttrs.status : 'unprocessed',
        paragraphIndex: Number.isInteger(existingAttrs.paragraphIndex)
          ? existingAttrs.paragraphIndex
          : paragraphIndex,
        length: text.length,
      },
    };
  }

  function normalizeNode(node) {
    if (!node || typeof node !== 'object') return node;

    if (STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type)) {
      const paragraphIndex = structuralIndex;
      structuralIndex += 1;
      const content = Array.isArray(node.content) ? node.content : [];
      const hasBlockSegments = content.some((child) => child?.type === 'blockSegment');
      const normalizedContent = hasBlockSegments
        ? content.map((child) => (
          child?.type === 'blockSegment'
            ? normalizeBlockSegment(child, paragraphIndex)
            : child
        ))
        : (textFromJsonNode(node).trim()
          ? [normalizeBlockSegment({
            type: 'blockSegment',
            attrs: legacyBlockSegmentAttrs(node.attrs),
            content,
          }, paragraphIndex)]
          : content);

      return {
        ...node,
        attrs: structuralContainerAttrs(node.attrs),
        content: normalizedContent,
      };
    }

    if (!Array.isArray(node.content)) return node;
    return {
      ...node,
      content: node.content.map(normalizeNode),
    };
  }

  return normalizeNode(contentJson);
}

export function hasUnfinishedBlocks(blocks) {
  return blocks.some((block) => (
    !block.isEmpty && UNFINISHED_BLOCK_STATUSES.has(block.status)
  ));
}

export function chooseNextUnfinishedBlock(blocks, currentBlockId) {
  const currentIndex = blocks.findIndex((block) => block.blockId === currentBlockId);
  const orderedBlocks = currentIndex >= 0
    ? [...blocks.slice(currentIndex + 1), ...blocks.slice(0, currentIndex)]
    : blocks;

  return orderedBlocks.find((block) => (
    !block.isEmpty && UNFINISHED_BLOCK_STATUSES.has(block.status)
  )) ?? null;
}

export function isSegmentedTextBlockSelection(state) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'blockSegment') return true;

    if (STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type.name)) {
      return node.content.content.some((child) => child.type.name === 'blockSegment');
    }
  }

  return false;
}

export function splitSegmentedTextBlock(state, dispatch) {
  if (!isSegmentedTextBlockSelection(state)) return false;
  return splitBlockKeepMarks(state, dispatch);
}
