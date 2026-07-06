import { Node } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import BulletList from '@tiptap/extension-bullet-list';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Heading from '@tiptap/extension-heading';
import Highlight from '@tiptap/extension-highlight';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import TextAlign from '@tiptap/extension-text-align';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { isHistoryTransaction } from 'prosemirror-history';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import A4EditorPage from './A4EditorPage.jsx';
import EditorToolbar from './EditorToolbar.jsx';

const A4_PAGE_HEIGHT_PX = 1123;
const TRACKED_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);

function generateBlockId(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}-${randomId}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTrackedTextBlockNode(node) {
  return TRACKED_TEXT_BLOCK_TYPES.has(node?.type?.name);
}

function normalizeBlockStatus(status) {
  return ['unprocessed', 'processing', 'processed', 'skipped'].includes(status)
    ? status
    : 'unprocessed';
}

function buildTrackedBlockStyleAttrs(attrs = {}) {
  return {
    lineHeight: attrs.lineHeight || '2.0',
    textIndent: attrs.textIndent || '0.5in',
    textAlign: attrs.textAlign || 'left',
    fontFamily: attrs.fontFamily || 'Times New Roman',
    fontSize: attrs.fontSize || '12pt',
  };
}

function renderTrackedBlock(tag, HTMLAttributes) {
  const style = [
    `line-height: ${HTMLAttributes.lineHeight}`,
    `text-indent: ${HTMLAttributes.textIndent}`,
    `text-align: ${HTMLAttributes.textAlign}`,
    `font-family: ${HTMLAttributes.fontFamily}`,
    `font-size: ${HTMLAttributes.fontSize}`,
  ].join('; ');

  return [
    tag,
    {
      ...HTMLAttributes,
      class: `doc-block doc-block--${HTMLAttributes.status || 'unprocessed'}`,
      'data-block-id': HTMLAttributes.blockId,
      'data-status': HTMLAttributes.status,
      style,
    },
    0,
  ];
}

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
    return renderTrackedBlock('p', HTMLAttributes);
  },
});

const AcademicHeading = Heading.extend({
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
  renderHTML({ node, HTMLAttributes }) {
    const level = this.options.levels.includes(node.attrs.level) ? node.attrs.level : this.options.levels[0];
    return renderTrackedBlock(`h${level}`, HTMLAttributes);
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
    if (isTrackedTextBlockNode(node)) {
      return {
        blockId: node.attrs.blockId ?? null,
        status: normalizeBlockStatus(node.attrs.status),
      };
    }
  }
  return { blockId: null, status: 'unprocessed' };
}

function collectTrackedBlocks(state) {
  const blocks = [];
  let order = 0;
  state.doc.descendants((node, pos) => {
    if (!isTrackedTextBlockNode(node)) return;

    const text = node.textContent ?? '';
    blocks.push({
      node,
      pos,
      order,
      blockId: node.attrs.blockId ?? null,
      status: normalizeBlockStatus(node.attrs.status),
      isEmpty: !text.trim(),
      text,
      length: text.length,
      type: node.type.name,
      attrs: {
        ...node.attrs,
        ...buildTrackedBlockStyleAttrs(node.attrs),
        blockId: node.attrs.blockId ?? null,
        status: normalizeBlockStatus(node.attrs.status),
        length: text.length,
      },
    });
    order += 1;
  });
  return blocks;
}

function createEditorSnapshot(editor) {
  if (!editor || editor.isDestroyed) {
    return {
      contentJson: null,
      blocks: [],
      currentProcessingBlockId: null,
    };
  }

  const blocks = collectTrackedBlocks(editor.state).map((block) => ({
    id: block.blockId,
    blockId: block.blockId,
    type: block.type,
    order: block.order,
    text: block.text,
    text_content: block.text,
    status: block.status,
    isEmpty: block.isEmpty,
    length: block.length,
    char_length: block.length,
    attrs: block.attrs,
  }));
  const currentProcessingBlockId = blocks.find((block) => !block.isEmpty && block.status === 'processing')?.id ?? null;

  return {
    contentJson: editor.getJSON(),
    blocks,
    currentProcessingBlockId,
  };
}

function reconcileEditorBlocks(editor, previousSnapshot, documentId, { skipEditedStatusReset = false } = {}) {
  if (!editor || editor.isDestroyed) return editor?.getJSON();

  let changed = false;
  const prefix = documentId || 'manual-document';

  editor.commands.command(({ state, tr, dispatch }) => {
    const seenBlockIds = new Set();
    let processingBlockId = null;
    const blocks = [];

    state.doc.descendants((node, pos) => {
      if (!isTrackedTextBlockNode(node)) return;

      const text = node.textContent ?? '';
      const isEmpty = !text.trim();
      let blockId = node.attrs.blockId ?? null;
      if (!blockId || seenBlockIds.has(blockId)) {
        blockId = generateBlockId(`${prefix}-block`);
      }
      seenBlockIds.add(blockId);

      let status = normalizeBlockStatus(node.attrs.status);
      if (!skipEditedStatusReset && previousSnapshot?.has(blockId) && ['processed', 'skipped'].includes(status)) {
        if ((previousSnapshot.get(blockId) ?? '') !== text) {
          status = 'unprocessed';
        }
      }
      if (isEmpty && status === 'processing') {
        status = 'unprocessed';
      }
      if (!isEmpty && status === 'processing') {
        if (!processingBlockId) {
          processingBlockId = blockId;
        } else {
          status = 'unprocessed';
        }
      }

      const nextAttrs = {
        ...node.attrs,
        ...buildTrackedBlockStyleAttrs(node.attrs),
        blockId,
        status,
        length: text.length,
      };
      blocks.push({ pos, nextAttrs, isEmpty, blockId, status });

      if (
        node.attrs.blockId !== nextAttrs.blockId
        || normalizeBlockStatus(node.attrs.status) !== nextAttrs.status
        || node.attrs.length !== nextAttrs.length
        || node.attrs.lineHeight !== nextAttrs.lineHeight
        || node.attrs.textIndent !== nextAttrs.textIndent
        || node.attrs.textAlign !== nextAttrs.textAlign
        || node.attrs.fontFamily !== nextAttrs.fontFamily
        || node.attrs.fontSize !== nextAttrs.fontSize
      ) {
        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      }
    });

    if (!processingBlockId) {
      const firstUnprocessed = blocks.find((block) => !block.isEmpty && block.nextAttrs.status === 'unprocessed');
      if (firstUnprocessed) {
        processingBlockId = firstUnprocessed.blockId;
        tr.setNodeMarkup(firstUnprocessed.pos, undefined, {
          ...firstUnprocessed.nextAttrs,
          status: 'processing',
        });
        changed = true;
      }
    }

    if (changed) {
      tr.setMeta('addToHistory', false);
      dispatch?.(tr);
    }
    return true;
  });

  return editor.getJSON();
}

function collectParagraphs(state) {
  return collectTrackedBlocks(state);
}

function selectedParagraphFromState(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!isTrackedTextBlockNode(node)) continue;

    return {
      node,
      pos: $from.before(depth),
      blockId: node.attrs.blockId ?? null,
      status: normalizeBlockStatus(node.attrs.status),
      isEmpty: !node.textContent?.trim(),
      text: node.textContent ?? '',
      length: (node.textContent ?? '').length,
      type: node.type.name,
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
    if (!isTrackedTextBlockNode(node) || !node.attrs.blockId) return;
    snapshot.set(node.attrs.blockId, node.textContent ?? '');
  });
  return snapshot;
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
        heading: false,
        underline: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
      }),
      AcademicParagraph,
      AcademicHeading,
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
    onUpdate({ editor: activeEditor, transaction }) {
      const skipEditedStatusReset = suppressEditedStatusResetRef.current || isHistoryTransaction(transaction);
      const normalizedJson = reconcileEditorBlocks(
        activeEditor,
        paragraphTextSnapshotRef.current,
        document?.id,
        { skipEditedStatusReset }
      );
      suppressEditedStatusResetRef.current = false;
      const info = selectedParagraphInfo(activeEditor);
      onChange?.({
        ...createEditorSnapshot(activeEditor),
        contentJson: normalizedJson,
        activeBlock: info,
      });
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
        if (!isTrackedTextBlockNode(node)) return;

        const nextAttrs = { ...node.attrs, ...attrs };
        const didChange = Object.entries(attrs).some(([key, value]) => node.attrs[key] !== value);
        if (!didChange) return;

        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      });

      if (changed) {
        tr.setMeta('addToHistory', false);
        dispatch?.(tr);
      }
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

  function applyCurrentBlockStatus({ status, replacementText = null, targetBlockId = null } = {}) {
    if (!editor || editor.isDestroyed) return;

    let updatedBlockId = selectedParagraphInfo(editor).blockId;
    let nextLocalProcessingId = null;
    let applied = false;

    suppressEditedStatusResetRef.current = true;
    editor.commands.command(({ state, tr, dispatch }) => {
      const paragraphs = collectParagraphs(state);
      const selected = selectedParagraphFromState(state);
      const target = (targetBlockId
        ? paragraphs.find((paragraph) => (
          paragraph.blockId === targetBlockId
          && !paragraph.isEmpty
          && ['processing', 'unprocessed'].includes(paragraph.status)
        ))
        : null)
        ?? ((selected && !selected.isEmpty && ['processing', 'unprocessed'].includes(selected.status))
        ? selected
        : paragraphs.find((paragraph) => !paragraph.isEmpty && paragraph.status === 'processing')
          ?? paragraphs.find((paragraph) => !paragraph.isEmpty && paragraph.status === 'unprocessed'));
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

    const snapshot = createEditorSnapshot(editor);
    setActiveBlockStatus(nextLocalProcessingId ? 'processing' : status);
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    if (applied && updatedBlockId) {
      onBlockStatusChange?.({
        blockId: updatedBlockId,
        status,
        nextProcessingBlockId: nextLocalProcessingId,
        ...snapshot,
      });
    }
    return applied ? snapshot : null;
  }

  useImperativeHandle(ref, () => ({
    applyCurrentBlockStatus,
    getSnapshot: () => createEditorSnapshot(editor),
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
