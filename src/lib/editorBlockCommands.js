import { splitBlockKeepMarks } from '@tiptap/pm/commands';

const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const UNFINISHED_BLOCK_STATUSES = new Set(['unprocessed', 'processing']);

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
