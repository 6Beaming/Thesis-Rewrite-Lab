import { splitBlockKeepMarks } from '@tiptap/pm/commands';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);
const UNFINISHED_BLOCK_STATUSES = new Set(['unprocessed', 'processing']);

function textFromJsonNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
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

export function trackedTextContentChanged(previousSnapshot, nextSnapshot) {
  const textSequence = (snapshot) => Array.from(snapshot?.values?.() ?? []).join('');
  return textSequence(previousSnapshot) !== textSequence(nextSnapshot);
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

export function insertSegmentedLineBreak(state, dispatch) {
  if (!isSegmentedTextBlockSelection(state)) return false;
  const hardBreak = state.schema.nodes.hardBreak;
  if (!hardBreak) return false;
  const { $from } = state.selection;
  if ($from.nodeBefore?.type === hardBreak) {
    let segmentDepth = null;
    let structuralDepth = null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name;
      if (segmentDepth == null && name === 'blockSegment') segmentDepth = depth;
      if (STRUCTURAL_TEXT_BLOCK_TYPES.has(name)) {
        structuralDepth = depth;
        break;
      }
    }
    if (segmentDepth != null && structuralDepth != null) {
      const segment = $from.node(segmentDepth);
      const structural = $from.node(structuralDepth);
      const segmentPos = $from.before(segmentDepth);
      const structuralPos = $from.before(structuralDepth);
      const offset = $from.pos - segmentPos - 1;
      const segmentOffset = segmentPos - structuralPos - 1;
      const leftContent = segment.content.cut(0, Math.max(0, offset - 1));
      const rightContent = segment.content.cut(offset, segment.content.size);
      const randomId = globalThis.crypto?.randomUUID?.()
        ?? `block-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const generation = (Number(segment.attrs.partitionGeneration) || 0) + 1;
      const leftSegment = segment.type.create({
        ...segment.attrs,
        status: segment.attrs.status === 'processing' ? 'unprocessed' : segment.attrs.status,
        resumeStatus: null,
        processingBaselineText: null,
        changeSource: 'manual',
        partitionGeneration: generation,
        length: leftContent.size,
      }, leftContent);
      const rightSegment = segment.type.create({
        ...segment.attrs,
        blockId: randomId,
        status: 'processing',
        resumeStatus: 'unprocessed',
        processingBaselineText: rightContent.textBetween(0, rightContent.size, '\n', '\n'),
        changeSource: 'none',
        partitionGeneration: generation,
        length: rightContent.size,
      }, rightContent);
      const before = structural.content.cut(0, segmentOffset);
      const after = structural.content.cut(segmentOffset + segment.nodeSize, structural.content.size);
      const left = structural.type.create(structural.attrs, before.append(Fragment.from(leftSegment)));
      const right = structural.type.create(structural.attrs, Fragment.from(rightSegment).append(after));
      const transaction = state.tr.replaceWith(
        structuralPos,
        structuralPos + structural.nodeSize,
        Fragment.fromArray([left, right]),
      );
      const rightStart = structuralPos + left.nodeSize + 2;
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(rightStart)));
      transaction.setMeta('editorBlockPartition', {
        type: 'hard-boundary',
        retiredBlockIds: [],
        survivingBlockIds: [segment.attrs.blockId, randomId],
        partitionGeneration: generation,
      });
      dispatch?.(transaction.scrollIntoView());
      return true;
    }
  }
  dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  return true;
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

  dispatch?.(state.tr
    .insertText(text)
    .setMeta('editorTextMutation', 'manual'));
  return true;
}

function structuralNodeAtPosition($position) {
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (!STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type.name)) continue;
    return {
      node,
      pos: $position.before(depth),
      offset: $position.pos - $position.start(depth),
    };
  }
  return null;
}

function structuralNodeWithContent(source, content) {
  const text = content.textBetween(0, content.size, '\n', '\n');
  return text.length ? source.type.create(source.attrs, content, source.marks) : null;
}

/**
 * Isolates partial structural selections before list/quote commands. Splitting
 * happens in the same history group as the immediately-following transform, so
 * Undo restores both the text blocks and their prior structure.
 */
export function isolateSelectionInTransaction(state, transaction = state?.tr) {
  if (!state || !transaction || transaction.selection.empty) return false;
  const start = structuralNodeAtPosition(transaction.selection.$from);
  const end = structuralNodeAtPosition(transaction.selection.$to);
  if (!start || !end) return false;
  const splitStart = start.offset > 0;
  const splitEnd = end.offset < end.node.content.size;
  if (!splitStart && !splitEnd) return false;

  let selectionStartPos = start.pos;
  let selectionEndPos = end.pos + end.node.nodeSize;

  if (start.pos === end.pos) {
    const before = structuralNodeWithContent(
      start.node,
      start.node.content.cut(0, start.offset),
    );
    const selected = structuralNodeWithContent(
      start.node,
      start.node.content.cut(start.offset, end.offset),
    );
    const after = structuralNodeWithContent(
      start.node,
      start.node.content.cut(end.offset, start.node.content.size),
    );
    if (!selected) return false;
    const replacements = [before, selected, after].filter(Boolean);
    transaction.replaceWith(
      start.pos,
      start.pos + start.node.nodeSize,
      Fragment.fromArray(replacements),
    );
    selectionStartPos = start.pos + (before?.nodeSize ?? 0);
    selectionEndPos = selectionStartPos + selected.nodeSize;
  } else {
    if (splitStart) {
      const before = structuralNodeWithContent(
        start.node,
        start.node.content.cut(0, start.offset),
      );
      const selectedStart = structuralNodeWithContent(
        start.node,
        start.node.content.cut(start.offset, start.node.content.size),
      );
      const replacements = [before, selectedStart].filter(Boolean);
      transaction.replaceWith(
        start.pos,
        start.pos + start.node.nodeSize,
        Fragment.fromArray(replacements),
      );
      selectionStartPos = start.pos + (before?.nodeSize ?? 0);
    }

    const mappedEndPos = transaction.mapping.map(end.pos, 1);
    if (splitEnd) {
      const selectedEnd = structuralNodeWithContent(
        end.node,
        end.node.content.cut(0, end.offset),
      );
      const after = structuralNodeWithContent(
        end.node,
        end.node.content.cut(end.offset, end.node.content.size),
      );
      const replacements = [selectedEnd, after].filter(Boolean);
      transaction.replaceWith(
        mappedEndPos,
        mappedEndPos + end.node.nodeSize,
        Fragment.fromArray(replacements),
      );
      selectionEndPos = mappedEndPos + (selectedEnd?.nodeSize ?? 0);
    } else {
      selectionEndPos = mappedEndPos + end.node.nodeSize;
    }
  }

  const fromSelection = TextSelection.near(
    transaction.doc.resolve(Math.min(transaction.doc.content.size, selectionStartPos + 1)),
    1,
  );
  const toSelection = TextSelection.near(
    transaction.doc.resolve(Math.max(0, selectionEndPos - 1)),
    -1,
  );
  transaction.setSelection(TextSelection.create(
    transaction.doc,
    fromSelection.from,
    Math.max(fromSelection.from, toSelection.to),
  ));
  transaction.setMeta('editorStructuralSelection', true);
  return true;
}

export function isolateSelectionForBlockTransform(editor) {
  if (!editor || editor.isDestroyed || editor.state.selection.empty) return false;
  const transaction = editor.state.tr;
  if (!isolateSelectionInTransaction(editor.state, transaction)) return false;
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
