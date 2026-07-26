import { EDITOR_PRESERVE_SCROLL_META } from './editorScrollGuard.js';

function trackedSegmentAtSelection(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== 'blockSegment') continue;
    return {
      node,
      pos: $from.before(depth),
    };
  }
  return null;
}

export function formattingTargetRange(editor) {
  if (!editor || editor.isDestroyed) return null;
  const { state } = editor;
  if (!state.selection.empty) {
    return {
      from: state.selection.from,
      to: state.selection.to,
      expanded: false,
    };
  }

  const selected = trackedSegmentAtSelection(state);
  if (selected?.node?.attrs?.status === 'processing') {
    return {
      from: selected.pos + 1,
      to: selected.pos + selected.node.nodeSize - 1,
      expanded: true,
    };
  }

  let processing = null;
  state.doc.descendants((node, pos) => {
    if (processing || node.type.name !== 'blockSegment') return;
    if (node.attrs.status === 'processing' && node.textContent.trim()) {
      processing = {
        from: pos + 1,
        to: pos + node.nodeSize - 1,
        expanded: true,
      };
    }
  });
  return processing;
}

/**
 * Runs a toolbar command in one transaction. A real text selection is honored;
 * an empty selection temporarily expands to the Processing block and is then
 * restored, so users can format the active block without drag-highlighting it.
 */
export function runToolbarCommand(editor, apply, {
  restoreSelection = true,
} = {}) {
  const range = formattingTargetRange(editor);
  if (!range) return false;
  const original = {
    from: editor.state.selection.from,
    to: editor.state.selection.to,
  };
  let chain = editor.chain().setMeta(EDITOR_PRESERVE_SCROLL_META, true);
  if (range.expanded) {
    chain = chain.setTextSelection({ from: range.from, to: range.to });
  }
  chain = apply(chain);
  if (range.expanded && restoreSelection) {
    chain = chain.setTextSelection(original);
  }
  const applied = chain.run();
  if (applied) focusEditorWithoutScroll(editor);
  return applied;
}

export function focusEditorWithoutScroll(editor) {
  if (!editor || editor.isDestroyed) return;
  window.requestAnimationFrame(() => {
    if (!editor.isDestroyed) {
      editor.view.dom.focus({ preventScroll: true });
    }
  });
}

export function currentProcessingTextAlign(editor) {
  if (!editor || editor.isDestroyed) return 'left';
  const range = formattingTargetRange(editor);
  const position = range?.from ?? editor.state.selection.from;
  const $position = editor.state.doc.resolve(Math.max(0, position));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      return node.attrs.textAlign || 'left';
    }
  }
  return 'left';
}
