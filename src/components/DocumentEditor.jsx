import { Extension, Node } from '@tiptap/core';
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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DEFAULT_CLUSTER_OPTIONS } from '../lib/clusteringOptions.js';
import { splitSegmentedTextBlock } from '../lib/editorBlockCommands.js';
import A4EditorPage from './A4EditorPage.jsx';
import EditorToolbar from './EditorToolbar.jsx';

const A4_PAGE_HEIGHT_PX = 1123;
const LEGACY_TRACKED_BLOCK_TYPES = new Set(['paragraph', 'heading']);

function generateBlockId(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}-${randomId}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTrackedTextBlockNode(node) {
  if (node?.type?.name === 'blockSegment') return true;
  if (!LEGACY_TRACKED_BLOCK_TYPES.has(node?.type?.name)) return false;
  if (node.attrs?.blockId) return true;
  return !node.content?.content?.some((child) => child.type?.name === 'blockSegment');
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

function trackedBlockStyle(HTMLAttributes) {
  return [
    `line-height: ${HTMLAttributes.lineHeight}`,
    `text-indent: ${HTMLAttributes.textIndent}`,
    `text-align: ${HTMLAttributes.textAlign}`,
    `font-family: ${HTMLAttributes.fontFamily}`,
    `font-size: ${HTMLAttributes.fontSize}`,
  ].join('; ');
}

function isStyleableTextNode(node) {
  return node?.type?.name === 'blockSegment'
    || LEGACY_TRACKED_BLOCK_TYPES.has(node?.type?.name);
}

function renderTrackedBlock(tag, HTMLAttributes) {
  const style = trackedBlockStyle(HTMLAttributes);

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

function renderAcademicContainer(tag, HTMLAttributes) {
  const {
    blockId: _blockId,
    status: _status,
    length: _length,
    paragraphIndex: _paragraphIndex,
    ...containerAttributes
  } = HTMLAttributes;

  return [
    tag,
    {
      ...containerAttributes,
      class: 'document-paragraph',
      style: trackedBlockStyle(HTMLAttributes),
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
    return HTMLAttributes.blockId
      ? renderTrackedBlock('p', HTMLAttributes)
      : renderAcademicContainer('p', HTMLAttributes);
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
    return HTMLAttributes.blockId
      ? renderTrackedBlock(`h${level}`, HTMLAttributes)
      : renderAcademicContainer(`h${level}`, HTMLAttributes);
  },
});

const BlockSegment = Node.create({
  name: 'blockSegment',
  group: 'inline',
  inline: true,
  content: 'text*',
  defining: true,
  selectable: false,
  addAttributes() {
    return {
      blockId: { default: null },
      status: { default: 'unprocessed' },
      paragraphIndex: { default: null },
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      textAlign: { default: 'left' },
      fontFamily: { default: 'Times New Roman' },
      fontSize: { default: '12pt' },
      length: { default: 0 },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-ai-block]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const rendered = renderTrackedBlock('span', HTMLAttributes);
    rendered[1]['data-ai-block'] = 'true';
    return rendered;
  },
});

const BlockSegmentEnter = Extension.create({
  name: 'blockSegmentEnter',
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      Enter: () => splitSegmentedTextBlock(this.editor.state, this.editor.view.dispatch),
    };
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
    const paragraphs = [];
    for (const [index, block] of document.blocks.entries()) {
      const node = block.tiptap_node ?? {
        type: 'blockSegment',
        attrs: {
          blockId: block.id,
          status: block.status,
          paragraphIndex: block.attrs?.paragraphIndex ?? index,
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
          length: block.text_content?.length ?? 0,
        },
        content: [{ type: 'text', text: block.text_content }],
      };

      if (node.type !== 'blockSegment') {
        paragraphs.push(node);
        continue;
      }

      const paragraphIndex = node.attrs?.paragraphIndex ?? index;
      let paragraph = paragraphs.at(-1);
      if (!paragraph || paragraph.attrs?.paragraphIndex !== paragraphIndex) {
        paragraph = {
          type: 'paragraph',
          attrs: {
            paragraphIndex,
            lineHeight: node.attrs?.lineHeight ?? '2.0',
            textIndent: node.attrs?.textIndent ?? '0.5in',
            textAlign: node.attrs?.textAlign ?? 'left',
            fontFamily: node.attrs?.fontFamily ?? 'Times New Roman',
            fontSize: node.attrs?.fontSize ?? '12pt',
          },
          content: [],
        };
        paragraphs.push(paragraph);
      }
      if (paragraph.content.length) paragraph.content.push({ type: 'text', text: ' ' });
      paragraph.content.push(node);
    }

    return {
      type: 'doc',
      content: paragraphs,
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
      const originalStatus = normalizeBlockStatus(node.attrs.status);
      return {
        blockId: node.attrs.blockId ?? null,
        status: 'processing',
        originalStatus,
        text: node.textContent ?? '',
      };
    }
  }
  return { blockId: null, status: 'unprocessed' };
}

function selectedBlockDecorationRange(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!isTrackedTextBlockNode(node)) continue;

    const from = $from.before(depth);
    return { from, to: from + node.nodeSize };
  }
  return null;
}

function syncSelectedBlockFrame(editor, blockId, pageElement) {
  if (!pageElement) return;

  let frame = pageElement.querySelector(':scope > .selected-block-frame');
  if (!blockId || !editor?.view?.dom) {
    if (frame) frame.hidden = true;
    return;
  }

  const selectedBlock = editor.view.dom.querySelector(
    `.doc-block[data-block-id="${CSS.escape(blockId)}"]`,
  );
  if (!selectedBlock) {
    if (frame) frame.hidden = true;
    return;
  }

  if (!frame) {
    frame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    frame.setAttribute('class', 'selected-block-frame');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('preserveAspectRatio', 'none');
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    outline.classList.add('selected-block-frame__outline');
    frame.append(outline);
    pageElement.append(frame);
  }

  const lineRects = Array.from(selectedBlock.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (!lineRects.length) {
    frame.hidden = true;
    return;
  }

  const pageRect = pageElement.getBoundingClientRect();
  const frameGap = 4;
  const left = Math.min(...lineRects.map((rect) => rect.left)) - frameGap;
  const top = Math.min(...lineRects.map((rect) => rect.top)) - frameGap;
  const right = Math.max(...lineRects.map((rect) => rect.right)) + frameGap;
  const bottom = Math.max(...lineRects.map((rect) => rect.bottom)) + frameGap;
  const width = right - left;
  const height = bottom - top;
  const expandedRects = lineRects.map((rect) => ({
    left: rect.left - frameGap - left,
    top: rect.top - frameGap - top,
    right: rect.right + frameGap - left,
    bottom: rect.bottom + frameGap - top,
  }));
  const points = [
    [expandedRects[0].left, expandedRects[0].top],
    [expandedRects[0].right, expandedRects[0].top],
  ];

  for (let index = 0; index < expandedRects.length; index += 1) {
    const rect = expandedRects[index];
    const next = expandedRects[index + 1];
    points.push([rect.right, rect.bottom]);
    if (next) points.push([next.right, rect.bottom], [next.right, next.top]);
  }
  points.push([expandedRects.at(-1).left, expandedRects.at(-1).bottom]);
  for (let index = expandedRects.length - 1; index > 0; index -= 1) {
    const rect = expandedRects[index];
    const previous = expandedRects[index - 1];
    points.push([rect.left, rect.top], [previous.left, rect.top], [previous.left, previous.bottom]);
  }

  const previousBlockId = frame.dataset.blockId;

  frame.hidden = false;
  frame.dataset.blockId = blockId;
  frame.dataset.status = 'processing';
  frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
  frame.querySelector('.selected-block-frame__outline').setAttribute(
    'points',
    points.map(([x, y]) => `${x},${y}`).join(' '),
  );
  frame.style.left = `${left - pageRect.left}px`;
  frame.style.top = `${top - pageRect.top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;

  if (previousBlockId !== blockId) {
    frame.classList.remove('is-entering');
    void frame.offsetWidth;
    frame.classList.add('is-entering');
  }
}

function selectedBlockActionButton({ action, label, className = '', disabled = false }) {
  const button = window.document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.selectedBlockAction = action;
  button.disabled = disabled;
  button.setAttribute('aria-label', label);
  button.addEventListener('mousedown', (event) => event.preventDefault());
  return button;
}

function createSelectedBlockActions(hasNextBlock) {
  const actions = window.document.createElement('span');
  actions.className = 'selected-block-actions';
  actions.contentEditable = 'false';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Selected block actions');

  const skipButton = selectedBlockActionButton({ action: 'skip', label: 'Skip selected block' });
  skipButton.textContent = 'Skip';

  const completeButton = selectedBlockActionButton({
    action: 'complete',
    label: 'Complete selected block',
    className: 'selected-block-action--complete',
  });
  completeButton.textContent = 'Complete';

  const nextButton = selectedBlockActionButton({
    action: 'next',
    label: 'Go to next block',
    className: 'selected-block-action--next',
    disabled: !hasNextBlock,
  });
  const arrow = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('aria-hidden', 'true');
  const shaft = window.document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shaft.setAttribute('d', 'M4 12h15M13 6l6 6-6 6');
  arrow.append(shaft);
  nextButton.append(arrow);

  actions.append(skipButton, completeButton, nextButton);
  return actions;
}

const BlockSelectionDecoration = Extension.create({
  name: 'blockSelectionDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockSelectionDecoration'),
        props: {
          decorations(state) {
            const range = selectedBlockDecorationRange(state);
            if (!range) return DecorationSet.empty;
            const blocks = collectTrackedBlocks(state).filter((block) => !block.isEmpty);
            const selected = selectedParagraphFromState(state);
            const selectedIndex = blocks.findIndex((block) => block.blockId === selected?.blockId);
            const hasNextBlock = selectedIndex >= 0 && selectedIndex < blocks.length - 1;
            return DecorationSet.create(state.doc, [
              Decoration.node(range.from, range.to, { class: 'doc-block--selected' }),
              Decoration.widget(
                range.to - 1,
                () => createSelectedBlockActions(hasNextBlock),
                {
                  key: `selected-block-actions-${selected?.blockId ?? 'none'}-${hasNextBlock}`,
                  side: 1,
                  stopEvent: (event) => Boolean(event.target.closest?.('[data-selected-block-action]')),
                },
              ),
            ]);
          },
        },
      }),
    ];
  },
});

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

function absorbUntrackedEditorText(editor) {
  if (!editor || editor.isDestroyed) return false;

  const replacements = [];
  editor.state.doc.descendants((node, pos) => {
    if (!LEGACY_TRACKED_BLOCK_TYPES.has(node.type.name)) return;
    const children = Array.from({ length: node.childCount }, (_, index) => node.child(index));
    if (!children.some((child) => child.type.name === 'blockSegment')) return;

    let changed = false;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child.isText || !child.text?.trim()) continue;

      let neighborIndex = index - 1;
      while (neighborIndex >= 0 && children[neighborIndex].type.name !== 'blockSegment') {
        neighborIndex -= 1;
      }
      const append = neighborIndex >= 0;
      if (!append) {
        neighborIndex = index + 1;
        while (neighborIndex < children.length && children[neighborIndex].type.name !== 'blockSegment') {
          neighborIndex += 1;
        }
      }
      if (neighborIndex < 0 || neighborIndex >= children.length) continue;

      const neighbor = children[neighborIndex];
      const content = Array.from(
        { length: neighbor.childCount },
        (_, childIndex) => neighbor.child(childIndex),
      );
      children[neighborIndex] = neighbor.type.create(
        neighbor.attrs,
        append ? [...content, child] : [child, ...content],
        neighbor.marks,
      );
      children.splice(index, 1);
      index -= 1;
      changed = true;
    }

    if (changed) replacements.push({ node, pos, children });
  });
  if (!replacements.length) return false;

  editor.commands.command(({ tr, dispatch }) => {
    replacements.sort((a, b) => b.pos - a.pos).forEach(({ node, pos, children }) => {
      tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, children, node.marks));
    });
    tr.setMeta('editorBlockNormalization', true);
    tr.setMeta('addToHistory', false);
    dispatch?.(tr);
    return true;
  });
  return true;
}

async function splitOversizedEditorBlocks(editor, documentId) {
  if (!editor || editor.isDestroyed) return false;

  const hasOversizedBlock = collectTrackedBlocks(editor.state)
    .some((block) => block.length > DEFAULT_CLUSTER_OPTIONS.maxChars);
  if (!hasOversizedBlock) return false;

  const { semanticClustering } = await import('../lib/clustering.js');
  if (editor.isDestroyed) return false;
  const oversizedBlocks = collectTrackedBlocks(editor.state)
    .filter((block) => block.length > DEFAULT_CLUSTER_OPTIONS.maxChars)
    .map((block) => ({ ...block, parts: semanticClustering(block.text) }))
    .filter((block) => block.parts.length > 1)
    .sort((a, b) => b.pos - a.pos);
  if (!oversizedBlocks.length) return false;

  const prefix = documentId || 'manual-document';
  editor.commands.command(({ state, tr, dispatch }) => {
    for (const block of oversizedBlocks) {
      const inlineBlocks = [];
      block.parts.forEach((text, index) => {
        if (index) inlineBlocks.push(state.schema.text(' '));
        const status = index === 0 ? block.status : 'unprocessed';
        inlineBlocks.push(state.schema.nodes.blockSegment.create({
          ...buildTrackedBlockStyleAttrs(block.attrs),
          paragraphIndex: block.attrs.paragraphIndex ?? null,
          blockId: index === 0 ? block.blockId : generateBlockId(`${prefix}-block`),
          status,
          length: text.length,
        }, text ? state.schema.text(text) : null));
      });

      if (block.type === 'blockSegment') {
        tr.replaceWith(block.pos, block.pos + block.node.nodeSize, inlineBlocks);
        continue;
      }

      tr.setNodeMarkup(block.pos, undefined, {
        ...block.node.attrs,
        blockId: null,
        status: 'unprocessed',
      });
      tr.replaceWith(block.pos + 1, block.pos + block.node.nodeSize - 1, inlineBlocks);
    }

    tr.setMeta('editorBlockPartition', true);
    tr.setMeta('addToHistory', false);
    dispatch?.(tr);
    return true;
  });
  return true;
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
  const blockPartitionTimerRef = useRef(null);
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
      BlockSegment,
      BlockSegmentEnter,
      BlockSelectionDecoration,
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
      absorbUntrackedEditorText(activeEditor);
      const skipEditedStatusReset = suppressEditedStatusResetRef.current || isHistoryTransaction(transaction);
      const normalizedJson = reconcileEditorBlocks(
        activeEditor,
        paragraphTextSnapshotRef.current,
        document?.id,
        { skipEditedStatusReset }
      );
      suppressEditedStatusResetRef.current = false;
      const info = selectedParagraphInfo(activeEditor);
      syncSelectedBlockFrame(activeEditor, info.blockId, pageRef.current);
      onChange?.({
        ...createEditorSnapshot(activeEditor),
        contentJson: normalizedJson,
        activeBlock: info,
      });
      onActiveBlockChange?.(info);
      paragraphTextSnapshotRef.current = paragraphTextSnapshot(activeEditor);

      if (
        transaction.docChanged
        && !transaction.getMeta('editorBlockPartition')
        && !transaction.getMeta('editorBlockNormalization')
        && !isHistoryTransaction(transaction)
      ) {
        clearTimeout(blockPartitionTimerRef.current);
        blockPartitionTimerRef.current = setTimeout(() => {
          void splitOversizedEditorBlocks(activeEditor, document?.id);
        }, 450);
      }
    },
    onSelectionUpdate({ editor: activeEditor }) {
      const info = selectedParagraphInfo(activeEditor);
      syncSelectedBlockFrame(activeEditor, info.blockId, pageRef.current);
      onActiveBlockChange?.(info);
    },
  }, [document?.id]);

  useEffect(() => {
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    const info = selectedParagraphInfo(editor);
    syncSelectedBlockFrame(editor, info.blockId, pageRef.current);
    onActiveBlockChange?.(info);
  }, [editor, document?.id, onActiveBlockChange]);

  useEffect(() => () => {
    clearTimeout(blockPartitionTimerRef.current);
  }, [document?.id]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !pageRef.current) return undefined;

    const refreshFrame = () => {
      const info = selectedParagraphInfo(editor);
      syncSelectedBlockFrame(editor, info.blockId, pageRef.current);
    };
    const observer = new ResizeObserver(refreshFrame);
    observer.observe(editor.view.dom);
    window.addEventListener('resize', refreshFrame);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refreshFrame);
    };
  }, [editor, document?.id]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;

    const handleSelectedBlockAction = (event) => {
      const button = event.target.closest?.('[data-selected-block-action]');
      if (!button || button.disabled) return;

      const action = button.dataset.selectedBlockAction;
      if (action === 'skip') setSelectedBlockStatus('skipped');
      if (action === 'complete') setSelectedBlockStatus('processed');
      if (action === 'next') selectNextBlock();
    };

    editor.view.dom.addEventListener('click', handleSelectedBlockAction);
    return () => editor.view.dom.removeEventListener('click', handleSelectedBlockAction);
  }, [editor, onBlockStatusChange]);

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
        if (!isStyleableTextNode(node)) return;

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
        ))
        : null)
        ?? ((selected && !selected.isEmpty)
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
    const blockId = selectedParagraphInfo(editor).blockId;
    applyCurrentBlockStatus({ status, targetBlockId: blockId });
  }

  function selectNextBlock() {
    if (!editor || editor.isDestroyed) return;

    const blocks = collectTrackedBlocks(editor.state).filter((block) => !block.isEmpty);
    const selectedBlockId = selectedParagraphInfo(editor).blockId;
    const selectedIndex = blocks.findIndex((block) => block.blockId === selectedBlockId);
    const nextBlock = selectedIndex >= 0 ? blocks[selectedIndex + 1] : blocks[0];
    if (!nextBlock) return;

    editor.chain().focus().setTextSelection(nextBlock.pos + 1).scrollIntoView().run();
  }

  return (
    <div className="document-editor">
      <EditorToolbar
        editor={editor}
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
