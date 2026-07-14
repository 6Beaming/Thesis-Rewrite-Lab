import { splitBlockKeepMarks } from '@tiptap/pm/commands';

const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);

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
