import { Node } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import BulletList from '@tiptap/extension-bullet-list';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import TextAlign from '@tiptap/extension-text-align';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import A4EditorPage from './A4EditorPage.jsx';
import EditorToolbar from './EditorToolbar.jsx';

const A4_PAGE_HEIGHT_PX = 1123;

const AcademicParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: { default: null },
      status: { default: 'unprocessed' },
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      textAlign: { default: 'left' },
      fontFamily: { default: 'Times New Roman' },
      fontSize: { default: '12pt' },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const style = [
      `line-height: ${HTMLAttributes.lineHeight}`,
      `text-indent: ${HTMLAttributes.textIndent}`,
      `text-align: ${HTMLAttributes.textAlign}`,
      `font-family: ${HTMLAttributes.fontFamily}`,
      `font-size: ${HTMLAttributes.fontSize}`,
    ].join('; ');

    return [
      'p',
      {
        ...HTMLAttributes,
        class: `doc-block doc-block--${HTMLAttributes.status || 'unprocessed'}`,
        'data-block-id': HTMLAttributes.blockId,
        'data-status': HTMLAttributes.status,
        style,
      },
      0,
    ];
  },
});

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'hr[data-page-break]' }];
  },
  renderHTML() {
    return ['hr', { 'data-page-break': 'true', class: 'page-break-node' }];
  },
});

function fallbackContent(document) {
  if (document?.content_json) return document.content_json;
  if (document?.blocks?.length) {
    return {
      type: 'doc',
      content: document.blocks.map((block) => block.tiptap_node ?? {
        type: 'paragraph',
        attrs: {
          blockId: block.id,
          status: block.status,
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
        },
        content: [{ type: 'text', text: block.text_content }],
      }),
    };
  }
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'demo-processing',
          status: 'processing',
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
        },
        content: [{ type: 'text', text: 'Assignment 2: article 2. This editable paper area is ready for local testing.' }],
      },
      {
        type: 'paragraph',
        attrs: {
          blockId: 'demo-unprocessed',
          status: 'unprocessed',
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
        },
        content: [{ type: 'text', text: 'Use the toolbar to change inline styling. The color blocks show processing status.' }],
      },
    ],
  };
}

function normalizeStyleSettings(styleSettings = {}) {
  return {
    margin: styleSettings.margin || '1 inch',
    fontFamily: styleSettings.font || styleSettings.fontFamily || 'Times New Roman',
    lineHeight: styleSettings.spacing || styleSettings.lineHeight || '2.0',
    textIndent: styleSettings.indentation || styleSettings.textIndent || '0.5in',
    fontSize: styleSettings.fontSize || '12pt',
    pageNumber: styleSettings.pageNumber || 'Bottom center',
  };
}

function cssLength(value, fallback) {
  const next = String(value ?? '').trim().replace(/\binch\b/g, 'in');
  return next || fallback;
}

function pageNumberPosition(pageNumber) {
  if (pageNumber === 'Top right') {
    return {
      '--paper-page-number-top-offset': '0.42in',
      '--paper-page-number-bottom-offset': '0.42in',
      '--paper-page-number-right': '0.5in',
      '--paper-page-number-left': 'auto',
      '--paper-page-number-transform': 'none',
    };
  }
  if (pageNumber === 'Bottom right') {
    return {
      '--paper-page-number-top-offset': '0.42in',
      '--paper-page-number-bottom-offset': '0.42in',
      '--paper-page-number-right': '0.5in',
      '--paper-page-number-left': 'auto',
      '--paper-page-number-transform': 'none',
    };
  }
  return {
    '--paper-page-number-top-offset': '0.42in',
    '--paper-page-number-bottom-offset': '0.42in',
    '--paper-page-number-right': 'auto',
    '--paper-page-number-left': '50%',
    '--paper-page-number-transform': 'translateX(-50%)',
  };
}

function selectedParagraphInfo(editor) {
  if (!editor || editor.isDestroyed) return { blockId: null, status: 'unprocessed' };

  const { state } = editor;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'paragraph') {
      return {
        blockId: node.attrs.blockId ?? null,
        status: node.attrs.status ?? 'unprocessed',
      };
    }
  }
  return { blockId: null, status: 'unprocessed' };
}

function ensureEditorBlockMetadata(editor, documentId) {
  if (!editor || editor.isDestroyed) return editor?.getJSON();

  let changed = false;
  let hasProcessing = false;
  let manualIndex = 0;
  const prefix = documentId || 'manual-document';
  const seenBlockIds = new Set();

  editor.commands.command(({ state, tr, dispatch }) => {
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return;
      const isEmpty = !node.textContent?.trim();

      const nextAttrs = { ...node.attrs };
      let nodeChanged = false;
      if (!nextAttrs.blockId || seenBlockIds.has(nextAttrs.blockId)) {
        manualIndex += 1;
        nextAttrs.blockId = `${prefix}-manual-${Date.now()}-${manualIndex}`;
        nextAttrs.status = 'unprocessed';
        nodeChanged = true;
      }
      seenBlockIds.add(nextAttrs.blockId);
      if (!nextAttrs.status) {
        nextAttrs.status = 'unprocessed';
        nodeChanged = true;
      }
      if (isEmpty && nextAttrs.status === 'processing') {
        nextAttrs.status = 'unprocessed';
        nodeChanged = true;
      }
      if (!isEmpty && nextAttrs.status === 'processing') {
        hasProcessing = true;
      }
      if (!nextAttrs.length) {
        nextAttrs.length = node.textContent?.length ?? 0;
        nodeChanged = true;
      }
      if (nodeChanged) {
        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      }
    });

    if (!hasProcessing) {
      let marked = false;
      tr.doc.descendants((node, pos) => {
        if (
          marked
          || node.type.name !== 'paragraph'
          || !node.textContent?.trim()
          || node.attrs?.status !== 'unprocessed'
        ) {
          return;
        }
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, status: 'processing' });
        marked = true;
        changed = true;
      });
    }

    if (changed) {
      dispatch?.(tr);
    }
    return true;
  });

  return editor.getJSON();
}

function collectParagraphs(state) {
  const paragraphs = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return;

    paragraphs.push({
      node,
      pos,
      blockId: node.attrs.blockId ?? null,
      status: node.attrs.status ?? 'unprocessed',
      isEmpty: !node.textContent?.trim(),
    });
  });
  return paragraphs;
}

function selectedParagraphFromState(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== 'paragraph') continue;

    return {
      node,
      pos: $from.before(depth),
      blockId: node.attrs.blockId ?? null,
      status: node.attrs.status ?? 'unprocessed',
      isEmpty: !node.textContent?.trim(),
    };
  }
  return null;
}

function chooseLocalNextProcessing(paragraphs, selectedBlockId) {
  return paragraphs.find((paragraph) => (
    paragraph.blockId !== selectedBlockId && !paragraph.isEmpty && paragraph.status === 'unprocessed'
  )) ?? null;
}

function paragraphTextSnapshot(editor) {
  const snapshot = new Map();
  if (!editor || editor.isDestroyed) return snapshot;

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'paragraph' || !node.attrs.blockId) return;
    snapshot.set(node.attrs.blockId, node.textContent ?? '');
  });
  return snapshot;
}

function markEditedCompletedBlocks(editor, previousSnapshot) {
  if (!editor || editor.isDestroyed || !previousSnapshot?.size) return false;

  let changed = false;
  editor.commands.command(({ state, tr, dispatch }) => {
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return;
      const blockId = node.attrs.blockId;
      if (!blockId || !previousSnapshot.has(blockId)) return;
      if (node.attrs.status !== 'processed' && node.attrs.status !== 'skipped') return;
      if ((node.textContent ?? '') === previousSnapshot.get(blockId)) return;

      tr.setNodeMarkup(pos, undefined, { ...node.attrs, status: 'unprocessed' });
      changed = true;
    });

    if (changed) {
      dispatch?.(tr);
    }
    return true;
  });

  return changed;
}

const DocumentEditor = forwardRef(function DocumentEditor({
  document,
  styleSettings,
  onChange,
  onBlockStatusChange,
  onActiveBlockChange,
  onSave,
  saveDisabled = false,
  saving = false,
}, ref) {
  const normalizedStyle = useMemo(() => normalizeStyleSettings(styleSettings), [styleSettings]);
  const styleSignature = useMemo(() => JSON.stringify(normalizedStyle), [normalizedStyle]);
  const paperScrollRef = useRef(null);
  const pageRef = useRef(null);
  const paragraphTextSnapshotRef = useRef(new Map());
  const suppressEditedStatusResetRef = useRef(false);
  const [activeBlockStatus, setActiveBlockStatus] = useState('unprocessed');
  const [pageCount, setPageCount] = useState(1);
  const processingBlockId = useMemo(() => {
    if (document?.current_processing_block_id) return document.current_processing_block_id;
    const processingBlock = document?.blocks?.find((block) => block.status === 'processing');
    return processingBlock?.id ?? null;
  }, [document]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: false,
        underline: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
      }),
      AcademicParagraph,
      PageBreak,
      BulletList.configure({ keepMarks: true }),
      OrderedList.configure({ keepMarks: true }),
      ListItem,
      Blockquote,
      TextStyle,
      FontSize,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: fallbackContent(document),
    editorProps: {
      attributes: {
        class: 'document-editor-surface',
      },
    },
    onUpdate({ editor: activeEditor }) {
      if (suppressEditedStatusResetRef.current) {
        suppressEditedStatusResetRef.current = false;
      } else {
        markEditedCompletedBlocks(activeEditor, paragraphTextSnapshotRef.current);
      }
      const normalizedJson = ensureEditorBlockMetadata(activeEditor, document?.id);
      const info = selectedParagraphInfo(activeEditor);
      onChange?.(normalizedJson);
      onActiveBlockChange?.(info);
      setActiveBlockStatus(info.status);
      paragraphTextSnapshotRef.current = paragraphTextSnapshot(activeEditor);
    },
    onSelectionUpdate({ editor: activeEditor }) {
      const info = selectedParagraphInfo(activeEditor);
      onActiveBlockChange?.(info);
      setActiveBlockStatus(info.status);
    },
  }, [document?.id]);

  useEffect(() => {
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    const info = selectedParagraphInfo(editor);
    onActiveBlockChange?.(info);
    setActiveBlockStatus(info.status);
  }, [editor, document?.id, onActiveBlockChange]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const attrs = {
      lineHeight: normalizedStyle.lineHeight,
      textIndent: normalizedStyle.textIndent,
      fontFamily: normalizedStyle.fontFamily,
      fontSize: normalizedStyle.fontSize,
    };

    editor.commands.command(({ state, tr, dispatch }) => {
      let changed = false;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph') return;

        const nextAttrs = { ...node.attrs, ...attrs };
        const didChange = Object.entries(attrs).some(([key, value]) => node.attrs[key] !== value);
        if (!didChange) return;

        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      });

      if (changed) dispatch?.(tr);
      return true;
    });
  }, [editor, styleSignature, normalizedStyle]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !paperScrollRef.current) return undefined;

    const timer = setTimeout(() => {
      const selector = processingBlockId
        ? `.doc-block[data-block-id="${CSS.escape(processingBlockId)}"]`
        : '.doc-block--processing';
      const target = paperScrollRef.current.querySelector(selector)
        ?? paperScrollRef.current.querySelector('.doc-block--processing');

      if (!target) return;

      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      target.classList.add('doc-block--jump-target');
      setTimeout(() => {
        target.classList.remove('doc-block--jump-target');
      }, 1800);
    }, 120);

    return () => {
      clearTimeout(timer);
    };
  }, [editor, document?.id]);

  useEffect(() => {
    if (!pageRef.current) return undefined;

    const updatePageCount = () => {
      const editorSurface = pageRef.current.querySelector('.document-editor-surface');
      const pageStyles = getComputedStyle(pageRef.current);
      const pageHeight = Number.parseFloat(pageStyles.getPropertyValue('--a4-page-height'))
        || A4_PAGE_HEIGHT_PX;
      const paddingTop = Number.parseFloat(pageStyles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(pageStyles.paddingBottom) || 0;
      const contentHeight = Math.max(
        paddingTop + (editorSurface?.scrollHeight ?? 0) + paddingBottom,
        pageHeight
      );
      const nextPageCount = Math.max(1, Math.ceil(contentHeight / pageHeight));
      setPageCount((current) => (current === nextPageCount ? current : nextPageCount));
    };

    updatePageCount();
    const observer = new ResizeObserver(updatePageCount);
    observer.observe(pageRef.current);
    const editorSurface = pageRef.current.querySelector('.document-editor-surface');
    if (editorSurface) observer.observe(editorSurface);

    return () => {
      observer.disconnect();
    };
  }, [editor, document?.id, styleSignature]);

  const pageStyle = {
    '--a4-page-height': `${A4_PAGE_HEIGHT_PX}px`,
    '--a4-page-count': pageCount,
    '--a4-paper-height': `${pageCount * A4_PAGE_HEIGHT_PX}px`,
    '--paper-margin': cssLength(normalizedStyle.margin, '1in'),
    '--paper-font-family': normalizedStyle.fontFamily,
    '--paper-line-height': normalizedStyle.lineHeight,
    '--paper-text-indent': normalizedStyle.textIndent,
    '--paper-font-size': normalizedStyle.fontSize,
    ...pageNumberPosition(normalizedStyle.pageNumber),
  };

  function applyCurrentBlockStatus({ status, replacementText = null } = {}) {
    if (!editor || editor.isDestroyed) return;

    let updatedBlockId = selectedParagraphInfo(editor).blockId;
    let nextLocalProcessingId = null;
    let applied = false;

    suppressEditedStatusResetRef.current = true;
    editor.commands.command(({ state, tr, dispatch }) => {
      const paragraphs = collectParagraphs(state);
      const selected = selectedParagraphFromState(state);
      const target = (selected && !selected.isEmpty && ['processing', 'unprocessed'].includes(selected.status))
        ? selected
        : paragraphs.find((paragraph) => !paragraph.isEmpty && paragraph.status === 'processing')
          ?? paragraphs.find((paragraph) => !paragraph.isEmpty && paragraph.status === 'unprocessed');
      if (!target) return false;

      updatedBlockId = target.blockId;

      if (status === 'processing') {
        paragraphs.forEach((paragraph) => {
          const nextStatus = paragraph.pos === target.pos ? 'processing' : (
            paragraph.status === 'processing' ? 'unprocessed' : paragraph.status
          );
          if (nextStatus === paragraph.status) return;
          tr.setNodeMarkup(paragraph.pos, undefined, { ...paragraph.node.attrs, status: nextStatus });
        });
      } else if (status === 'processed' || status === 'skipped') {
        const nextProcessing = chooseLocalNextProcessing(paragraphs, target.blockId);
        nextLocalProcessingId = nextProcessing?.blockId ?? null;
        let replacementRange = null;
        paragraphs.forEach((paragraph) => {
          let nextStatus = paragraph.status;
          const nextAttrs = { ...paragraph.node.attrs };
          if (paragraph.pos === target.pos) {
            nextStatus = status;
          } else if (nextProcessing && paragraph.blockId === nextProcessing.blockId) {
            nextStatus = 'processing';
          } else if (paragraph.status === 'processing') {
            nextStatus = 'unprocessed';
          }

          nextAttrs.status = nextStatus;
          if (paragraph.pos === target.pos && replacementText !== null) {
            nextAttrs.length = replacementText.length;
          }
          const attrsChanged = nextStatus !== paragraph.status
            || (paragraph.pos === target.pos && replacementText !== null);
          if (attrsChanged) {
            tr.setNodeMarkup(paragraph.pos, undefined, nextAttrs);
          }
          if (paragraph.pos === target.pos && replacementText !== null) {
            replacementRange = {
              from: paragraph.pos + 1,
              to: paragraph.pos + paragraph.node.nodeSize - 1,
            };
          }
        });

        if (replacementRange) {
          if (replacementText) {
            tr.replaceWith(replacementRange.from, replacementRange.to, state.schema.text(replacementText));
          } else {
            tr.delete(replacementRange.from, replacementRange.to);
          }
        }

        if (nextProcessing) {
          const selectionPos = tr.mapping.map(nextProcessing.pos + 1);
          tr.setSelection(state.selection.constructor.near(tr.doc.resolve(selectionPos)));
        }
      } else {
        tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, status });
      }

      dispatch?.(tr.scrollIntoView());
      applied = true;
      return true;
    });
    if (!applied) {
      suppressEditedStatusResetRef.current = false;
    }

    setActiveBlockStatus(nextLocalProcessingId ? 'processing' : status);
    const contentJson = editor.getJSON();
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    if (applied && updatedBlockId) {
      onBlockStatusChange?.({
        blockId: updatedBlockId,
        status,
        nextProcessingBlockId: nextLocalProcessingId,
        contentJson,
      });
    }
    return applied ? contentJson : null;
  }

  useImperativeHandle(ref, () => ({
    applyCurrentBlockStatus,
  }), [editor, onBlockStatusChange]);

  function setSelectedBlockStatus(status) {
    applyCurrentBlockStatus({ status });
  }

  return (
    <div className="document-editor">
      <EditorToolbar
        editor={editor}
        activeBlockStatus={activeBlockStatus}
        onBlockStatusChange={setSelectedBlockStatus}
        onSave={onSave}
        saveDisabled={saveDisabled}
        saving={saving}
      />
      <div className="paper-scroll" ref={paperScrollRef}>
        <A4EditorPage
          ref={pageRef}
          pageCount={pageCount}
          pageNumberPosition={normalizedStyle.pageNumber}
          style={pageStyle}
        >
          <EditorContent editor={editor} />
        </A4EditorPage>
      </div>
    </div>
  );
});

export default DocumentEditor;
