import { splitBlockKeepMarks } from '@tiptap/pm/commands';
import { TextSelection } from '@tiptap/pm/state';

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

  let sourceBlock = null;
  let sourceBlockPos = null;
  for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
    const node = state.selection.$from.node(depth);
    if (node.type.name === 'blockSegment') {
      sourceBlock = node;
      sourceBlockPos = state.selection.$from.before(depth);
      break;
    }
  }

  return splitBlockKeepMarks(state, (transaction) => {
    const { $from } = transaction.selection;
    let containingTextBlock = null;
    let splitBlock = null;
    let splitBlockPos = null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === 'blockSegment') {
        splitBlock = node;
        splitBlockPos = $from.before(depth);
      }
      if (STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type.name)) {
        containingTextBlock = node;
        break;
      }
    }

    // The split copies the inline node into the new paragraph. Give that copy
    // its own identity and unfinished status in the same transaction, so the
    // first typed character does not trigger a follow-up normalization.
    if (sourceBlock && containingTextBlock) {
      const randomId = globalThis.crypto?.randomUUID?.();
      const blockId = randomId
        ? `block-${randomId}`
        : `block-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const leftBlockPos = sourceBlockPos == null
        ? null
        : transaction.mapping.map(sourceBlockPos, -1);
      const leftBlock = leftBlockPos == null ? null : transaction.doc.nodeAt(leftBlockPos);

      if (splitBlock && splitBlockPos != null && leftBlock?.type.name === 'blockSegment') {
        const leftIsEmpty = !leftBlock.textContent.trim();
        transaction.setNodeMarkup(splitBlockPos, undefined, {
          ...splitBlock.attrs,
          blockId: leftIsEmpty ? sourceBlock.attrs.blockId : blockId,
          status: leftIsEmpty ? sourceBlock.attrs.status : 'unprocessed',
          length: splitBlock.textContent.length,
        });
        transaction.setNodeMarkup(leftBlockPos, undefined, {
          ...leftBlock.attrs,
          blockId: leftIsEmpty ? blockId : sourceBlock.attrs.blockId,
          status: leftIsEmpty ? 'unprocessed' : sourceBlock.attrs.status,
          length: leftBlock.textContent.length,
        });
      } else {
        const block = sourceBlock.type.create({
          ...sourceBlock.attrs,
          blockId,
          status: 'unprocessed',
          length: 0,
        });
        const insertAt = transaction.selection.from;
        transaction.insert(insertAt, block);
        transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1));
      }
    }

    dispatch?.(transaction);
  });
}

export function insertTextIntoSelectedSegment(state, dispatch, text) {
  if (!text) return false;

  function selectedSegment($position) {
    for (let depth = $position.depth; depth > 0; depth -= 1) {
      const node = $position.node(depth);
      if (node.type.name === 'blockSegment') return node;
    }
    return null;
  }

  const fromSegment = selectedSegment(state.selection.$from);
  const toSegment = selectedSegment(state.selection.$to);
  if (!fromSegment || fromSegment !== toSegment) return false;

  dispatch?.(state.tr.insertText(text).scrollIntoView());
  return true;
}
