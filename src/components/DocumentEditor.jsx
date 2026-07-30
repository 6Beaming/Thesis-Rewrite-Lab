import { Extension, mergeAttributes, Node } from '@tiptap/core';
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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildAnalysisPhraseDecorations } from '../lib/analysisPhraseDecorations.js';
import {
  academicStyleSettings,
  DEFAULT_UPLOAD_ACADEMIC_STYLE,
} from '../shared/academicStyleTemplates.js';
import {
  countCharacters,
  DEFAULT_SEGMENTATION_POLICY,
  segmentText,
} from '../lib/blockSegmentation/index.js';
import {
  normalizeBlockStatus,
  normalizeChangeSource,
  normalizeResumeStatus,
} from '../lib/blockState.js';
import {
  cancelScheduledAnimationFrame,
  EDITOR_PRESERVE_SCROLL_META,
  scheduleAnimationFrameOnce,
  shouldRestoreEditorScroll,
} from '../lib/editorScrollGuard.js';
import {
  chooseNextUnfinishedBlock,
  convertLegacyTrackedBlocks,
  hasUnfinishedBlocks,
  insertTextIntoSelectedSegment,
  selectEntireEditorDocument,
  splitSegmentedTextBlock,
  trackedTextContentChanged,
} from '../lib/editorBlockCommands.js';
import {
  frameAtPoint,
  separateAdjacentBlockRects,
} from '../lib/blockFrameGeometry.js';
import { NlpIssueDecorationPlugin } from '../extensions/NlpIssueDecorationPlugin.js';
import {
  applyBlockNlpAttrs,
  invalidateBlockNlpAttrs,
} from '../lib/nlp/blockNlpSnapshot.js';
import A4EditorPage from './A4EditorPage.jsx';
import EditorToolbar from './EditorToolbar.jsx';

const A4_PAGE_HEIGHT_PX = 1123;
const PAGE_GUTTER_HEIGHT_PX = 54;
const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const EMPTY_ANALYSIS_HIGHLIGHTS = Object.freeze([]);
const EMPTY_NLP_ISSUES = Object.freeze([]);
const PAGINATION_META = 'editorPagination';
const PAGINATION_PLUGIN_KEY = new PluginKey('paginationDecoration');
const SKIP_BLOCK_PARTITION_META = 'skipEditorBlockPartition';
const BLOCK_FRAME_HIT_TOLERANCE_PX = 1.5;
const BLOCK_POINTER_GEOMETRY = new WeakMap();

function generateBlockId(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  const values = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (values) {
    values[6] = (values[6] & 0x0f) | 0x40;
    values[8] = (values[8] & 0x3f) | 0x80;
    const hex = Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  void prefix;
  throw new Error('Secure UUID generation is unavailable.');
}

function isTrackedTextBlockNode(node) {
  return node?.type?.name === 'blockSegment';
}

function trackedNodeText(node) {
  if (!node) return '';
  return node.textBetween(0, node.content.size, '\n', '\n');
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

function trackedBlockStyle(HTMLAttributes, { headingLevel = null } = {}) {
  const headingSizes = { 1: '24pt', 2: '18pt', 3: '14pt' };
  const headingFontSize = headingLevel
    ? (HTMLAttributes.fontSize || headingSizes[headingLevel])
    : HTMLAttributes.fontSize;
  return [
    `line-height: ${HTMLAttributes.lineHeight}`,
    `text-indent: ${HTMLAttributes.textIndent}`,
    `text-align: ${HTMLAttributes.textAlign}`,
    `font-family: ${HTMLAttributes.fontFamily}`,
    `font-size: ${headingFontSize}`,
  ].join('; ');
}

function isStyleableTextNode(node) {
  return node?.type?.name === 'blockSegment'
    || STRUCTURAL_TEXT_BLOCK_TYPES.has(node?.type?.name);
}

function renderTrackedBlock(tag, HTMLAttributes) {
  const {
    nlpAnalysis: _nlpAnalysis,
    nlpReasonCodes: _nlpReasonCodes,
    semanticAnchor: _semanticAnchor,
    nlpSnapshotFingerprint: _nlpSnapshotFingerprint,
    nlpTextHash: _nlpTextHash,
    nlpPipelineVersion: _nlpPipelineVersion,
    nlpCheckedAt: _nlpCheckedAt,
    headingRestoreAttrs: _headingRestoreAttrs,
    preserveHeadingStyle: _preserveHeadingStyle,
    ...renderedAttributes
  } = HTMLAttributes;
  const style = trackedBlockStyle(renderedAttributes);

  return [
    tag,
    {
      ...renderedAttributes,
      class: `doc-block doc-block--${renderedAttributes.status || 'unprocessed'}`,
      'data-block-id': renderedAttributes.blockId,
      'data-status': renderedAttributes.status,
      'data-nlp-status': renderedAttributes.nlpStatus,
      'data-source-type': renderedAttributes.sourceType,
      style,
    },
    0,
  ];
}

function renderAcademicContainer(tag, HTMLAttributes, options) {
  const {
    blockId: _blockId,
    status: _status,
    length: _length,
    paragraphIndex: _paragraphIndex,
    formatOverrides: _formatOverrides,
    preserveHeadingStyle,
    ...containerAttributes
  } = HTMLAttributes;

  return [
    tag,
    {
      ...containerAttributes,
      class: 'document-paragraph',
      'data-preserve-heading-style': preserveHeadingStyle ? 'true' : 'false',
      style: trackedBlockStyle(HTMLAttributes, options),
    },
    0,
  ];
}

const AcademicParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      textAlign: { default: 'left' },
      fontFamily: { default: 'Times New Roman' },
      fontSize: { default: '12pt' },
      formatOverrides: { default: [] },
      outlineLevel: { default: 'none' },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return renderAcademicContainer('p', HTMLAttributes);
  },
});

const AcademicHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      textAlign: { default: 'left' },
      fontFamily: { default: 'Times New Roman' },
      fontSize: { default: '12pt' },
      formatOverrides: { default: [] },
      outlineLevel: { default: '1' },
      preserveHeadingStyle: { default: false },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = this.options.levels.includes(node.attrs.level) ? node.attrs.level : this.options.levels[0];
    return renderAcademicContainer(`h${level}`, HTMLAttributes, { headingLevel: level });
  },
});

const BlockSegment = Node.create({
  name: 'blockSegment',
  group: 'inline',
  inline: true,
  content: '(text | hardBreak)*',
  defining: true,
  atom: false,
  selectable: false,
  addAttributes() {
    return {
      blockId: { default: null },
      status: { default: 'unprocessed' },
      resumeStatus: { default: null },
      processingBaselineText: { default: null },
      changeSource: { default: 'none' },
      partitionGeneration: { default: 0 },
      formatOverrides: { default: [] },
      paragraphIndex: { default: null },
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      textAlign: { default: 'left' },
      fontFamily: { default: 'Times New Roman' },
      fontSize: { default: '12pt' },
      sourceType: { default: 'paragraph' },
      level: { default: null },
      headingRestoreAttrs: { default: null },
      preserveHeadingStyle: { default: false },
      length: { default: 0 },
      nlpStatus: { default: 'unknown' },
      nlpReasonCodes: { default: [] },
      nlpAnalysis: { default: {} },
      nlpTextHash: { default: null },
      nlpPipelineVersion: { default: null },
      nlpSnapshotFingerprint: { default: null },
      semanticCoherence: { default: null },
      semanticAnchor: { default: null },
      nlpCheckedAt: { default: null },
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
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockSegmentTextInput'),
        props: {
          handleTextInput: (view, _from, _to, text) => (
            insertTextIntoSelectedSegment(view.state, view.dispatch, text)
          ),
        },
      }),
    ];
  },
});

const DocumentSelectAll = Extension.create({
  name: 'documentSelectAll',
  priority: 1200,
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => selectEntireEditorDocument(
        this.editor.state,
        this.editor.view.dispatch,
      ),
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

const AcademicOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      restartNumbering: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-restart-numbering'),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const {
      start,
      type,
      restartNumbering,
      ...attributes
    } = HTMLAttributes;
    const rendered = mergeAttributes(this.options.HTMLAttributes, attributes);
    if (start !== 1) rendered.start = start;
    if (type && type !== '1') rendered.type = type;
    if (restartNumbering) rendered['data-restart-numbering'] = 'true';
    rendered['data-renumberable'] = 'true';
    rendered['aria-label'] = 'Ordered list. Click a number or right-click to renumber from 1.';
    return ['ol', rendered, 0];
  },
});

const OrderedListNumbering = Extension.create({
  name: 'orderedListNumbering',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('orderedListNumbering'),
      appendTransaction(transactions, _oldState, newState) {
        if (
          !transactions.some((transaction) => transaction.docChanged)
          || transactions.some((transaction) => transaction.getMeta('orderedListNumbering'))
        ) {
          return null;
        }
        let nextStart = 1;
        let changed = false;
        const transaction = newState.tr;
        newState.doc.descendants((node, pos) => {
          if (node.type.name !== 'orderedList' || newState.doc.resolve(pos).depth !== 0) return;
          if (node.attrs.restartNumbering) nextStart = 1;
          if (node.attrs.start !== nextStart) {
            transaction.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              start: nextStart,
            });
            changed = true;
          }
          nextStart += node.childCount;
          return false;
        });
        if (!changed) return null;
        transaction
          .setMeta('orderedListNumbering', true)
          .setMeta('addToHistory', false);
        return transaction;
      },
    })];
  },
});

const PaginationDecoration = Extension.create({
  name: 'paginationDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: PAGINATION_PLUGIN_KEY,
      state: {
        init: () => [],
        apply(transaction, positions) {
          const supplied = transaction.getMeta(PAGINATION_META);
          if (Array.isArray(supplied)) return supplied;
          return positions
            .map((position) => transaction.mapping.map(position, -1))
            .filter((position) => position > 0 && position < transaction.doc.content.size);
        },
      },
      props: {
        decorations(state) {
          const positions = PAGINATION_PLUGIN_KEY.getState(state);
          if (!positions.length) return DecorationSet.empty;
          return DecorationSet.create(state.doc, positions.map((position, index) => (
            Decoration.widget(position, () => {
              const gap = document.createElement('span');
              gap.className = 'editor-page-gap';
              gap.contentEditable = 'false';
              gap.setAttribute('aria-hidden', 'true');
              const precedingPageNumber = document.createElement('span');
              precedingPageNumber.className = 'editor-page-number editor-page-number--bottom';
              precedingPageNumber.textContent = String(index + 1);
              const followingPageNumber = document.createElement('span');
              followingPageNumber.className = 'editor-page-number editor-page-number--top';
              followingPageNumber.textContent = String(index + 2);
              gap.append(precedingPageNumber, followingPageNumber);
              return gap;
            }, { side: -1, key: `page-gap-${index}-${position}` })
          )));
        },
      },
    })];
  },
});

function fallbackContent(document) {
  const createBlockId = () => generateBlockId(`${document?.id || 'document'}-block`);
  if (document?.content_json) {
    return convertLegacyTrackedBlocks(document.content_json, createBlockId);
  }
  if (document?.blocks?.length) {
    const paragraphs = [];
    for (const [index, block] of document.blocks.entries()) {
      const node = block.tiptap_node ?? {
        type: 'blockSegment',
        attrs: {
          blockId: block.id,
          status: block.status,
          resumeStatus: block.resume_status ?? null,
          processingBaselineText: block.processing_baseline_text ?? null,
          changeSource: block.change_source ?? 'none',
          partitionGeneration: block.partition_generation ?? 0,
          formatOverrides: block.format_overrides ?? [],
          paragraphIndex: block.attrs?.paragraphIndex ?? index,
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
          length: countCharacters(block.text_content),
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

    return convertLegacyTrackedBlocks({
      type: 'doc',
      content: paragraphs,
    }, createBlockId);
  }
  return {
    type: 'doc',
    content: [],
  };
}

function normalizeStyleSettings(styleSettings = {}) {
  const legacyMargin = String(styleSettings.margin || '1in').replace(/\s*inch(?:es)?$/i, 'in');
  const normalizedLength = (value, fallback) => (
    /^\d*\.?\d+(?:in|cm|mm|pt|px)$/i.test(String(value ?? '').trim())
      ? String(value).trim()
      : fallback
  );
  return {
    marginTop: normalizedLength(styleSettings.marginTop, legacyMargin),
    marginRight: normalizedLength(styleSettings.marginRight, legacyMargin),
    marginBottom: normalizedLength(styleSettings.marginBottom, legacyMargin),
    marginLeft: normalizedLength(styleSettings.marginLeft, legacyMargin),
    fontFamily: styleSettings.font || styleSettings.fontFamily || 'Times New Roman',
    lineHeight: styleSettings.spacing || styleSettings.lineHeight || '2.0',
    textIndent: styleSettings.indentation || styleSettings.textIndent || '0.5in',
    fontSize: styleSettings.fontSize || '12pt',
    headingStyles: styleSettings.headingStyles ?? null,
    pageNumber: styleSettings.pageNumber || 'Bottom center',
    referenceList: styleSettings.referenceList ?? null,
    bibliography: styleSettings.bibliography ?? null,
    blockQuote: styleSettings.blockQuote ?? null,
    footnote: styleSettings.footnote ?? null,
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
  const blocks = collectTrackedBlocks(state);
  const blockSelectionActive = editor.storage.blockSelectionDecoration?.active;
  if (
    blockSelectionActive === false
    || (blockSelectionActive == null && !hasUnfinishedBlocks(blocks))
  ) {
    return { blockId: null, status: 'unprocessed' };
  }

  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (isTrackedTextBlockNode(node)) {
      const originalStatus = normalizeBlockStatus(node.attrs.status);
      return {
        blockId: node.attrs.blockId ?? null,
        status: originalStatus,
        originalStatus,
        text: trackedNodeText(node),
        sourceTextHash: null,
        partitionGeneration: Number(node.attrs.partitionGeneration) || 0,
        changeSource: normalizeChangeSource(node.attrs.changeSource),
      };
    }
  }
  const processing = blocks.find((block) => block.status === 'processing' && !block.isEmpty);
  if (processing) {
    return {
      blockId: processing.blockId,
      status: processing.status,
      originalStatus: processing.status,
      text: processing.text,
      sourceTextHash: null,
      partitionGeneration: Number(processing.attrs.partitionGeneration) || 0,
      changeSource: normalizeChangeSource(processing.attrs.changeSource),
    };
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

function citationTextRange(doc, anchor) {
  if (!doc || !anchor?.blockId) return null;
  let targetRange = null;
  doc.descendants((node, pos) => {
    if (
      targetRange
      || !isTrackedTextBlockNode(node)
      || node.attrs.blockId !== anchor.blockId
    ) return;
    const codePoints = Array.from(node.textContent);
    const startCp = Math.max(
      0,
      Math.min(codePoints.length, Number(anchor.citationStartCp) || 0),
    );
    const endCp = Math.max(
      startCp,
      Math.min(codePoints.length, Number(anchor.citationEndCp) || startCp),
    );
    const startOffset = codePoints.slice(0, startCp).join('').length;
    const endOffset = codePoints.slice(0, endCp).join('').length;
    targetRange = {
      from: pos + 1 + startOffset,
      to: pos + 1 + endOffset,
    };
  });
  return targetRange;
}

function lineRectsForBlock(blockElement) {
  const range = window.document.createRange();
  range.selectNodeContents(blockElement);
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .reduce((lines, rect) => {
      const currentLine = lines.at(-1);
      const overlapHeight = currentLine
        ? Math.min(rect.bottom, currentLine.bottom) - Math.max(rect.top, currentLine.top)
        : 0;
      const overlapsCurrentLine = currentLine
        && overlapHeight > Math.min(rect.height, currentLine.bottom - currentLine.top) / 2;
      if (!overlapsCurrentLine) {
        lines.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
        return lines;
      }

      currentLine.left = Math.min(currentLine.left, rect.left);
      currentLine.top = Math.min(currentLine.top, rect.top);
      currentLine.right = Math.max(currentLine.right, rect.right);
      currentLine.bottom = Math.max(currentLine.bottom, rect.bottom);
      return lines;
    }, []);
}

function expandedBlockRects(blockElement, frameGap = 5) {
  const lines = lineRectsForBlock(blockElement);
  if (!lines.length) return [];
  const lineHeight = Number.parseFloat(getComputedStyle(blockElement).lineHeight);
  const expanded = lines.map((rect) => {
    const verticalGap = Number.isFinite(lineHeight)
      ? Math.max(frameGap, ((lineHeight - (rect.bottom - rect.top)) / 2) + 1)
      : frameGap;
    return {
      left: rect.left - frameGap,
      top: rect.top - verticalGap,
      right: rect.right + frameGap,
      bottom: rect.bottom + verticalGap,
    };
  });

  for (let index = 1; index < expanded.length; index += 1) {
    const boundary = (lines[index - 1].bottom + lines[index].top) / 2;
    expanded[index - 1].bottom = boundary;
    expanded[index].top = boundary;
  }
  return expanded;
}

function polygonPointsForRects(rects, left, top) {
  const relative = rects.map((rect) => ({
    left: rect.left - left,
    top: rect.top - top,
    right: rect.right - left,
    bottom: rect.bottom - top,
  }));
  const points = [
    [relative[0].left, relative[0].top],
    [relative[0].right, relative[0].top],
  ];
  for (let index = 0; index < relative.length; index += 1) {
    const rect = relative[index];
    const next = relative[index + 1];
    points.push([rect.right, rect.bottom]);
    if (next) points.push([next.right, rect.bottom], [next.right, next.top]);
  }
  points.push([relative.at(-1).left, relative.at(-1).bottom]);
  for (let index = relative.length - 1; index > 0; index -= 1) {
    const rect = relative[index];
    const previous = relative[index - 1];
    points.push([rect.left, rect.top], [previous.left, rect.top], [previous.left, previous.bottom]);
  }
  return points;
}

function blockElementAtPoint(editor, pageElement, target, clientX, clientY) {
  const directBlock = target?.closest?.('.doc-block[data-block-id]');
  if (directBlock && editor?.view?.dom?.contains(directBlock)) return directBlock;
  if (!pageElement) return null;

  const pageRect = pageElement.getBoundingClientRect();
  return frameAtPoint(
    BLOCK_POINTER_GEOMETRY.get(pageElement),
    clientX - pageRect.left,
    clientY - pageRect.top,
    BLOCK_FRAME_HIT_TOLERANCE_PX,
  )?.blockElement ?? null;
}

function syncBlockStatusFrames(editor, pageElement, hoveredBlockId = null) {
  if (!pageElement || !editor?.view?.dom) return;
  const existingFrames = new Map(Array.from(
    pageElement.querySelectorAll(':scope > .block-status-frame'),
    (frame) => [frame.dataset.blockId, frame],
  ));
  const pageRect = pageElement.getBoundingClientRect();

  const frameGeometry = Array.from(
    editor.view.dom.querySelectorAll('.doc-block[data-block-id]'),
  ).map((blockElement) => ({
    blockElement,
    blockId: blockElement.dataset.blockId,
    status: normalizeBlockStatus(blockElement.dataset.status),
    selected: blockElement.classList.contains('doc-block--selected'),
    rects: expandedBlockRects(blockElement),
  })).filter(({ blockId, rects }) => blockId && rects.length);

  const separatedFrameGeometry = separateAdjacentBlockRects(frameGeometry);
  BLOCK_POINTER_GEOMETRY.set(pageElement, separatedFrameGeometry.map((frame) => ({
    ...frame,
    rects: frame.rects.map((rect) => ({
      left: rect.left - pageRect.left,
      top: rect.top - pageRect.top,
      right: rect.right - pageRect.left,
      bottom: rect.bottom - pageRect.top,
    })),
  })));

  separatedFrameGeometry.forEach(({
    blockId,
    status,
    selected,
    rects,
  }) => {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    let frame = existingFrames.get(blockId);

    if (!frame) {
      frame = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      frame.setAttribute('class', 'block-status-frame');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('preserveAspectRatio', 'none');
      const shape = window.document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      shape.classList.add('block-status-frame__shape');
      frame.append(shape);
      pageElement.append(frame);
    }

    frame.dataset.blockId = blockId;
    frame.dataset.status = status;
    frame.dataset.selected = selected ? 'true' : 'false';
    frame.classList.toggle('is-hovered', blockId === hoveredBlockId);
    frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
    frame.querySelector('.block-status-frame__shape').setAttribute(
      'points',
      polygonPointsForRects(rects, left, top)
        .map(([x, y]) => `${x},${y}`)
        .join(' '),
    );
    frame.style.left = `${left - pageRect.left}px`;
    frame.style.top = `${top - pageRect.top}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    existingFrames.delete(blockId);
  });

  existingFrames.forEach((frame) => frame.remove());
}

function orderedListPositionForElement(editor, listElement) {
  if (!editor?.view?.dom || !listElement) return null;
  const rawPosition = editor.view.posAtDOM(listElement, 0);
  for (const candidate of [rawPosition, rawPosition - 1]) {
    if (
      candidate >= 0
      && candidate <= editor.state.doc.content.size
      && editor.state.doc.nodeAt(candidate)?.type.name === 'orderedList'
    ) {
      return candidate;
    }
  }

  const $position = editor.state.doc.resolve(Math.max(
    0,
    Math.min(editor.state.doc.content.size, rawPosition),
  ));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if ($position.node(depth).type.name === 'orderedList') {
      return $position.before(depth);
    }
  }
  return null;
}

function isOrderedListMarkerClick(event, listItem) {
  const content = listItem?.querySelector?.('.doc-block');
  if (!content) return false;
  const contentRect = content.getBoundingClientRect();
  const listRect = listItem.closest('ol')?.getBoundingClientRect();
  const markerLeft = Math.min(listRect?.left ?? contentRect.left - 44, contentRect.left - 44);
  return event.clientX >= markerLeft - 4 && event.clientX <= contentRect.left - 2;
}

function syncSelectedBlockFrame(editor, blockId, pageElement, hoveredBlockId = null) {
  if (!pageElement) return;
  syncBlockStatusFrames(editor, pageElement, hoveredBlockId);

  let frame = pageElement.querySelector(':scope > .selected-block-frame');
  let actions = pageElement.querySelector(':scope > .selected-block-actions');
  if (!blockId || !editor?.view?.dom) {
    if (frame) frame.setAttribute('hidden', '');
    if (actions) actions.setAttribute('hidden', '');
    return;
  }

  const selectedBlock = editor.view.dom.querySelector(
    `.doc-block[data-block-id="${CSS.escape(blockId)}"]`,
  );
  if (!selectedBlock) {
    if (frame) frame.setAttribute('hidden', '');
    if (actions) actions.setAttribute('hidden', '');
    return;
  }

  if (
    !actions
    || actions.dataset.blockId !== blockId
  ) {
    const nextActions = createSelectedBlockActions(blockId);
    if (actions) {
      actions.replaceWith(nextActions);
    } else {
      pageElement.append(nextActions);
    }
    actions = nextActions;
  }
  actions.removeAttribute('hidden');

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

  const selectedTextRange = document.createRange();
  selectedTextRange.selectNodeContents(selectedBlock);

  const lineRects = Array.from(selectedTextRange.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .reduce((lines, rect) => {
      const currentLine = lines.at(-1);
      const overlapHeight = currentLine
        ? Math.min(rect.bottom, currentLine.bottom) - Math.max(rect.top, currentLine.top)
        : 0;
      const overlapsCurrentLine = currentLine
        && overlapHeight > Math.min(rect.height, currentLine.bottom - currentLine.top) / 2;
      if (!overlapsCurrentLine) {
        lines.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
        return lines;
      }

      currentLine.left = Math.min(currentLine.left, rect.left);
      currentLine.top = Math.min(currentLine.top, rect.top);
      currentLine.right = Math.max(currentLine.right, rect.right);
      currentLine.bottom = Math.max(currentLine.bottom, rect.bottom);
      return lines;
    }, []);

  const pageRect = pageElement.getBoundingClientRect();
  const editorRect = editor.view.dom.getBoundingClientRect();
  const selectedBlockRect = selectedBlock.getBoundingClientRect();
  const paragraphRect = selectedBlock.closest('.document-paragraph')?.getBoundingClientRect()
    ?? selectedBlockRect;
  const textIndent = Number.parseFloat(getComputedStyle(selectedBlock).textIndent) || 0;
  const preferredActionsLeft = lineRects[0]?.left
    ?? Math.max(selectedBlockRect.left, editorRect.left + textIndent);
  const actionsRect = actions.getBoundingClientRect();
  const actionsLeft = Math.max(
    editorRect.left,
    Math.min(preferredActionsLeft, editorRect.right - actionsRect.width),
  );
  const selectedBlockTop = lineRects[0]?.top ?? selectedBlockRect.top ?? paragraphRect.top;
  actions.style.left = `${actionsLeft - pageRect.left}px`;
  actions.style.top = `${selectedBlockTop - actionsRect.height - 5 - pageRect.top}px`;

  if (!lineRects.length) {
    frame.setAttribute('hidden', '');
    return;
  }

  const frameGap = 4;
  const left = editorRect.left - frameGap;
  const top = Math.min(...lineRects.map((rect) => rect.top)) - frameGap;
  const right = editorRect.right + frameGap;
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

  frame.removeAttribute('hidden');
  frame.dataset.blockId = blockId;
  frame.dataset.status = normalizeBlockStatus(selectedBlock.dataset.status);
  frame.dataset.selected = selectedBlock.classList.contains('doc-block--selected')
    ? 'true'
    : 'false';
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

function selectedBlockActionButton({
  action,
  blockId,
  label,
  className = '',
  disabled = false,
}) {
  const button = window.document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.selectedBlockAction = action;
  if (blockId) button.dataset.selectedBlockId = blockId;
  button.disabled = disabled;
  button.setAttribute('aria-label', label);
  button.addEventListener('mousedown', (event) => event.preventDefault());
  return button;
}

function createSelectedBlockActions(blockId) {
  const actions = window.document.createElement('span');
  actions.className = 'selected-block-actions';
  actions.dataset.blockId = blockId ?? '';
  actions.contentEditable = 'false';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Selected block actions');

  const skipButton = selectedBlockActionButton({
    action: 'skip',
    blockId,
    label: 'Skip selected block',
  });
  skipButton.textContent = 'Skip';

  const completeButton = selectedBlockActionButton({
    action: 'complete',
    blockId,
    label: 'Complete selected block',
    className: 'selected-block-action--complete',
  });
  completeButton.textContent = 'Complete';

  actions.append(skipButton, completeButton);
  return actions;
}

const BlockSelectionDecoration = Extension.create({
  name: 'blockSelectionDecoration',
  addStorage() {
    return { active: null };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockSelectionDecoration'),
        props: {
          decorations: (state) => {
            const blocks = collectTrackedBlocks(state).filter((block) => !block.isEmpty);
            if (
              this.storage.active === false
              || (this.storage.active == null && !hasUnfinishedBlocks(blocks))
            ) {
              return DecorationSet.empty;
            }

            const range = selectedBlockDecorationRange(state);
            if (!range) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.node(range.from, range.to, { class: 'doc-block--selected' }),
            ]);
          },
        },
      }),
    ];
  },
});

const AnalysisPhraseDecoration = Extension.create({
  name: 'analysisPhraseDecoration',
  addStorage() {
    return { highlights: EMPTY_ANALYSIS_HIGHLIGHTS };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('analysisPhraseDecoration'),
        props: {
          decorations: (state) => buildAnalysisPhraseDecorations(state, this.storage.highlights),
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

    const text = trackedNodeText(node);
    const length = countCharacters(text);
    blocks.push({
      node,
      pos,
      order,
      blockId: node.attrs.blockId ?? null,
      status: normalizeBlockStatus(node.attrs.status),
      isEmpty: !text.trim(),
      text,
      length,
      type: node.type.name,
      attrs: {
        ...node.attrs,
        ...buildTrackedBlockStyleAttrs(node.attrs),
        blockId: node.attrs.blockId ?? null,
        status: normalizeBlockStatus(node.attrs.status),
        resumeStatus: node.attrs.resumeStatus ?? null,
        processingBaselineText: node.attrs.processingBaselineText ?? null,
        changeSource: normalizeChangeSource(node.attrs.changeSource),
        partitionGeneration: Math.max(0, Number(node.attrs.partitionGeneration) || 0),
        formatOverrides: node.attrs.formatOverrides ?? {},
        length,
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
    resume_status: block.attrs.resumeStatus,
    processing_baseline_text: block.attrs.processingBaselineText,
    change_source: block.attrs.changeSource,
    partition_generation: block.attrs.partitionGeneration,
    format_overrides: block.attrs.formatOverrides,
    nlp_status: block.attrs.nlpStatus,
    nlp_reason_codes: block.attrs.nlpReasonCodes,
    nlp_analysis: block.attrs.nlpAnalysis,
    nlp_text_hash: block.attrs.nlpTextHash,
    nlp_pipeline_version: block.attrs.nlpPipelineVersion,
    nlp_snapshot_fingerprint: block.attrs.nlpSnapshotFingerprint,
    semantic_coherence: block.attrs.semanticCoherence,
    semantic_anchor: block.attrs.semanticAnchor,
    nlp_checked_at: block.attrs.nlpCheckedAt,
  }));
  const currentProcessingBlockId = blocks.find((block) => !block.isEmpty && block.status === 'processing')?.id ?? null;

  return {
    contentJson: editor.getJSON(),
    blocks,
    currentProcessingBlockId,
  };
}

function reconcileEditorBlocks(editor, previousSnapshot, documentId, {
  skipEditedStatusReset = false,
} = {}) {
  if (!editor || editor.isDestroyed) return editor?.getJSON();

  let changed = false;
  const prefix = documentId || 'manual-document';

  editor.commands.command(({ state, tr, dispatch }) => {
    const seenBlockIds = new Set();
    let processingBlockId = null;
    const blocks = [];

    state.doc.descendants((node, pos) => {
      if (!isTrackedTextBlockNode(node)) return;

      const text = trackedNodeText(node);
      const length = countCharacters(text);
      const isEmpty = !text.trim();
      let blockId = node.attrs.blockId ?? null;
      if (!blockId || seenBlockIds.has(blockId)) {
        blockId = generateBlockId(`${prefix}-block`);
      }
      seenBlockIds.add(blockId);

      let status = normalizeBlockStatus(node.attrs.status);
      let resumeStatus = status === 'processing'
        ? normalizeResumeStatus(node.attrs.resumeStatus)
        : null;
      let processingBaselineText = status === 'processing'
        ? String(node.attrs.processingBaselineText ?? text)
        : null;
      let changeSource = normalizeChangeSource(node.attrs.changeSource);
      if (isEmpty && status === 'processing') {
        status = resumeStatus;
        resumeStatus = null;
        processingBaselineText = null;
        changeSource = 'none';
      }
      if (!isEmpty && status === 'processing') {
        if (!processingBlockId) {
          processingBlockId = blockId;
          if (!skipEditedStatusReset) {
            changeSource = text === processingBaselineText ? 'none' : 'manual';
          }
        } else {
          const unchanged = text === processingBaselineText;
          status = unchanged ? resumeStatus : 'unprocessed';
          resumeStatus = null;
          processingBaselineText = null;
          changeSource = unchanged ? 'none' : 'manual';
        }
      }

      const baseAttrs = {
        ...node.attrs,
        ...buildTrackedBlockStyleAttrs(node.attrs),
        blockId,
        status,
        resumeStatus,
        processingBaselineText,
        changeSource,
        partitionGeneration: Math.max(0, Number(node.attrs.partitionGeneration) || 0),
        formatOverrides: node.attrs.formatOverrides ?? {},
        length,
      };
      const nextAttrs = previousSnapshot?.has(blockId)
        && previousSnapshot.get(blockId) !== text
        ? invalidateBlockNlpAttrs(baseAttrs)
        : baseAttrs;
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
        || node.attrs.resumeStatus !== nextAttrs.resumeStatus
        || node.attrs.processingBaselineText !== nextAttrs.processingBaselineText
        || node.attrs.changeSource !== nextAttrs.changeSource
        || node.attrs.partitionGeneration !== nextAttrs.partitionGeneration
        || JSON.stringify(node.attrs.formatOverrides ?? {}) !== JSON.stringify(nextAttrs.formatOverrides)
      ) {
        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      }
    });

    if (changed) {
      tr.setMeta('addToHistory', false);
      dispatch?.(tr);
    }
    return true;
  });

  return editor.getJSON();
}

function activateSelectedEditorBlock(editor) {
  if (!editor || editor.isDestroyed) return false;
  const selected = selectedParagraphFromState(editor.state);
  if (!selected || selected.isEmpty) return false;
  const blocks = collectTrackedBlocks(editor.state);
  const current = blocks.find((block) => block.status === 'processing');
  if (current?.blockId === selected.blockId) return false;

  let changed = false;
  editor.commands.command(({ state, tr, dispatch }) => {
    for (const block of collectTrackedBlocks(state)) {
      if (block.blockId === selected.blockId) {
        tr.setNodeMarkup(block.pos, undefined, {
          ...block.node.attrs,
          status: 'processing',
          resumeStatus: normalizeResumeStatus(block.status),
          processingBaselineText: block.text,
          changeSource: 'none',
        });
        changed = true;
        continue;
      }
      if (block.status !== 'processing') continue;
      const baseline = String(block.attrs.processingBaselineText ?? block.text);
      const unchanged = block.text === baseline;
      tr.setNodeMarkup(block.pos, undefined, {
        ...block.node.attrs,
        status: unchanged
          ? normalizeResumeStatus(block.attrs.resumeStatus)
          : 'unprocessed',
        resumeStatus: null,
        processingBaselineText: null,
        changeSource: unchanged ? 'none' : 'manual',
      });
      changed = true;
    }
    if (!changed) return false;
    tr.setMeta('blockStateTransition', 'select');
    tr.setMeta('addToHistory', false);
    dispatch?.(tr);
    return true;
  });
  return changed;
}

function deactivateSelectedEditorBlock(editor) {
  if (!editor || editor.isDestroyed) return false;
  editor.storage.blockSelectionDecoration.active = false;

  let changed = false;
  editor.commands.command(({ state, tr, dispatch }) => {
    for (const block of collectTrackedBlocks(state)) {
      if (block.status !== 'processing') continue;
      const baseline = String(block.attrs.processingBaselineText ?? block.text);
      const unchanged = block.text === baseline;
      tr.setNodeMarkup(block.pos, undefined, {
        ...block.node.attrs,
        status: unchanged
          ? normalizeResumeStatus(block.attrs.resumeStatus)
          : 'unprocessed',
        resumeStatus: null,
        processingBaselineText: null,
        changeSource: unchanged ? 'none' : 'manual',
      });
      changed = true;
    }
    tr.setMeta('blockSelectionDeactivation', true);
    tr.setMeta('blockStateTransition', 'deselect');
    tr.setMeta('addToHistory', false);
    dispatch?.(tr);
    return true;
  });
  return changed;
}

function normalizeEditorBlockNodes(editor, documentId) {
  if (!editor || editor.isDestroyed) return false;

  const replacements = [];
  let paragraphIndex = 0;
  editor.state.doc.descendants((node, pos) => {
    if (!STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type.name)) return;
    const currentParagraphIndex = paragraphIndex;
    paragraphIndex += 1;
    const children = Array.from({ length: node.childCount }, (_, index) => node.child(index));
    if (!children.some((child) => child.type.name === 'blockSegment')) {
      const text = trackedNodeText(node);
      if (!text.trim()) return false;

      replacements.push({
        node,
        pos,
        children: [editor.state.schema.nodes.blockSegment.create({
          ...buildTrackedBlockStyleAttrs(node.attrs),
          blockId: generateBlockId(`${documentId || 'manual-document'}-block`),
          status: 'unprocessed',
          resumeStatus: null,
          processingBaselineText: null,
          changeSource: 'none',
          partitionGeneration: 0,
          formatOverrides: [],
          paragraphIndex: currentParagraphIndex,
          length: countCharacters(text),
        }, node.content)],
      });
      return false;
    }

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
    return false;
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

function structuralAncestorPosition(state, position) {
  const $position = state.doc.resolve(Math.min(state.doc.content.size, position + 1));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if (STRUCTURAL_TEXT_BLOCK_TYPES.has($position.node(depth).type.name)) {
      return $position.before(depth);
    }
  }
  return null;
}

function repartitionAffectedEditorBlock(editor, documentId, blockId) {
  if (!editor || editor.isDestroyed) return false;
  const blocks = collectTrackedBlocks(editor.state).filter((block) => !block.isEmpty);
  const blockIndex = blocks.findIndex((block) => block.blockId === blockId);
  const block = blocks[blockIndex];
  if (!block) return false;
  const prefix = documentId || 'manual-document';

  if (block.length <= DEFAULT_SEGMENTATION_POLICY.maxChars) {
    const previous = blocks[blockIndex - 1];
    const sharesStructuralContainer = previous
      && structuralAncestorPosition(editor.state, previous.pos)
        === structuralAncestorPosition(editor.state, block.pos);
    const previousEnd = previous ? previous.pos + previous.node.nodeSize : 0;
    const separatorText = previous
      ? editor.state.doc.textBetween(previousEnd, block.pos, '\n', '\n')
      : '';
    const combinedText = previous ? `${previous.text}${separatorText}${block.text}` : block.text;
    if (
      block.length >= DEFAULT_SEGMENTATION_POLICY.minChars
      || !previous
      || !sharesStructuralContainer
      || previous.attrs.paragraphIndex !== block.attrs.paragraphIndex
      || /\n[^\S\r\n]*\n/.test(separatorText)
      || countCharacters(combinedText) > DEFAULT_SEGMENTATION_POLICY.maxChars
    ) {
      return false;
    }

    editor.commands.command(({ state, tr, dispatch }) => {
      const separator = state.doc.slice(previousEnd, block.pos).content;
      const mergedContent = previous.node.content
        .append(separator)
        .append(block.node.content);
      const mergedText = combinedText;
      const partitionGeneration = Math.max(
        Number(previous.attrs.partitionGeneration) || 0,
        Number(block.attrs.partitionGeneration) || 0,
      ) + 1;
      const selectedIsCurrent = selectedParagraphFromState(state)?.blockId === block.blockId;
      const mergedStatus = selectedIsCurrent || previous.status === 'processing'
        ? 'processing'
        : 'unprocessed';
      const attrs = {
        ...previous.node.attrs,
        status: mergedStatus,
        resumeStatus: mergedStatus === 'processing' ? 'unprocessed' : null,
        processingBaselineText: mergedStatus === 'processing' ? mergedText : null,
        changeSource: 'manual',
        partitionGeneration,
        length: countCharacters(mergedText),
      };
      const merged = previous.node.type.create(attrs, mergedContent, previous.node.marks);
      tr.replaceWith(previous.pos, block.pos + block.node.nodeSize, merged);
      tr.setMeta('editorBlockPartition', {
        type: 'merge',
        retiredBlockIds: [block.blockId],
        survivingBlockIds: [previous.blockId],
        partitionGeneration,
      });
      dispatch?.(tr);
      return true;
    });
    return true;
  }

  const ranges = segmentText(block.text);
  if (ranges.length <= 1) return false;

  editor.commands.command(({ state, tr, dispatch }) => {
    const inlineBlocks = [];
    const selectedOffset = Math.max(
      0,
      state.selection.from - block.pos - 1,
    );
    const selectedSegmentIndex = Math.max(
      0,
      ranges.findIndex((range) => selectedOffset >= range.start && selectedOffset <= range.end),
    );
    const partitionGeneration = (Number(block.attrs.partitionGeneration) || 0) + 1;
    const createdIds = [];
    ranges.forEach((range, index) => {
      const nextId = index === 0 ? block.blockId : generateBlockId(`${prefix}-block`);
      createdIds.push(nextId);
      const status = index === selectedSegmentIndex && block.status === 'processing'
        ? 'processing'
        : 'unprocessed';
      const content = block.node.content.cut(range.start, range.end);
      inlineBlocks.push(state.schema.nodes.blockSegment.create({
          ...buildTrackedBlockStyleAttrs(block.attrs),
          paragraphIndex: block.attrs.paragraphIndex ?? null,
          blockId: nextId,
          status,
          resumeStatus: status === 'processing' ? 'unprocessed' : null,
          processingBaselineText: status === 'processing' ? range.text : null,
          changeSource: status === 'processing' ? 'manual' : 'none',
          partitionGeneration,
          formatOverrides: block.attrs.formatOverrides ?? {},
          length: countCharacters(range.text),
        }, content));
    });

    tr.replaceWith(block.pos, block.pos + block.node.nodeSize, inlineBlocks);

    tr.setMeta('editorBlockPartition', {
      type: 'split',
      retiredBlockIds: [],
      survivingBlockIds: createdIds,
      partitionGeneration,
    });
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
      isEmpty: !trackedNodeText(node).trim(),
      text: trackedNodeText(node),
      length: countCharacters(trackedNodeText(node)),
      type: node.type.name,
    };
  }
  return null;
}

function paragraphTextSnapshotFromState(state) {
  const snapshot = new Map();
  if (!state?.doc) return snapshot;

  state.doc.descendants((node) => {
    if (!isTrackedTextBlockNode(node) || !node.attrs.blockId) return;
    snapshot.set(node.attrs.blockId, trackedNodeText(node));
  });
  return snapshot;
}

function paragraphTextSnapshot(editor) {
  if (!editor || editor.isDestroyed) return new Map();
  return paragraphTextSnapshotFromState(editor.state);
}

const DocumentEditor = forwardRef(function DocumentEditor({
  document,
  styleSettings,
  onChange,
  onBlockStatusChange,
  onActiveBlockChange,
  analysisHighlights = EMPTY_ANALYSIS_HIGHLIGHTS,
  nlpIssues = EMPTY_NLP_ISSUES,
  onSave,
  onExport,
  saveDisabled = false,
  saving = false,
  exporting = false,
  initialScrollPosition = null,
  onInitialScrollRestored,
  pureMode = true,
  onTogglePureMode,
}, ref) {
  const normalizedStyle = useMemo(
    () => normalizeStyleSettings(academicStyleSettings(document?.academic_style, styleSettings)),
    [document?.academic_style, styleSettings],
  );
  const styleSignature = useMemo(() => JSON.stringify(normalizedStyle), [normalizedStyle]);
  const paperScrollRef = useRef(null);
  const pageRef = useRef(null);
  const frameSyncRafRef = useRef(null);
  const hoveredBlockIdRef = useRef(null);
  const scrollGuardRafRef = useRef(null);
  const scrollGuardTimerRef = useRef(null);
  const scrollGuardRef = useRef(null);
  const paragraphTextSnapshotRef = useRef(new Map());
  const suppressEditedStatusResetRef = useRef(false);
  const suppressProgrammaticPartitionRef = useRef(false);
  const blockPartitionTimerRef = useRef(null);
  const suppressProgrammaticUpdateRef = useRef(false);
  const callbacksRef = useRef({ onChange, onBlockStatusChange, onActiveBlockChange });
  callbacksRef.current = { onChange, onBlockStatusChange, onActiveBlockChange };
  const [pageCount, setPageCount] = useState(1);
  const [orderedListMenu, setOrderedListMenu] = useState(null);
  const [blockVisualsVisible, setBlockVisualsVisible] = useState(true);

  function captureEditorScrollPosition() {
    return {
      paper: {
        top: paperScrollRef.current?.scrollTop ?? 0,
        left: paperScrollRef.current?.scrollLeft ?? 0,
      },
      window: {
        top: window.scrollY,
        left: window.scrollX,
      },
    };
  }

  function restoreGuardedEditorScroll() {
    const guard = scrollGuardRef.current;
    if (!guard) return;
    if (guard.expiresAt < performance.now()) {
      scrollGuardRef.current = null;
      return;
    }
    const paper = paperScrollRef.current;
    const current = captureEditorScrollPosition();
    if (paper && shouldRestoreEditorScroll(guard.position.paper, current.paper, {
      preserveExact: guard.preserveExact,
      viewportHeight: paper.clientHeight,
      viewportWidth: paper.clientWidth,
    })) {
      paper.scrollTop = guard.position.paper.top;
      paper.scrollLeft = guard.position.paper.left;
    }
    if (shouldRestoreEditorScroll(guard.position.window, current.window, {
      preserveExact: guard.preserveExact,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    })) {
      window.scrollTo(guard.position.window.left, guard.position.window.top);
    }
  }

  function scheduleGuardedEditorScrollRestore() {
    if (scrollGuardRafRef.current) cancelAnimationFrame(scrollGuardRafRef.current);
    if (scrollGuardTimerRef.current) clearTimeout(scrollGuardTimerRef.current);
    restoreGuardedEditorScroll();
    scrollGuardRafRef.current = requestAnimationFrame(() => {
      restoreGuardedEditorScroll();
      scrollGuardRafRef.current = requestAnimationFrame(() => {
        scrollGuardRafRef.current = null;
        restoreGuardedEditorScroll();
      });
    });
    scrollGuardTimerRef.current = setTimeout(() => {
      scrollGuardTimerRef.current = null;
      restoreGuardedEditorScroll();
      scrollGuardRef.current = null;
    }, 160);
  }

  function scheduleBlockFrameSync(activeEditor) {
    if (!activeEditor || activeEditor.isDestroyed || !pageRef.current) return;
    scheduleAnimationFrameOnce(frameSyncRafRef, requestAnimationFrame, () => {
      if (activeEditor.isDestroyed || !pageRef.current) return;
      const info = selectedParagraphInfo(activeEditor);
      syncSelectedBlockFrame(
        activeEditor,
        info.blockId,
        pageRef.current,
        hoveredBlockIdRef.current,
      );
    });
  }

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
      DocumentSelectAll,
      BlockSegmentEnter,
      BlockSelectionDecoration,
      AnalysisPhraseDecoration,
      NlpIssueDecorationPlugin,
      PageBreak,
      PaginationDecoration,
      BulletList.configure({ keepMarks: true }),
      AcademicOrderedList.configure({ keepMarks: true }),
      OrderedListNumbering,
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
    onBeforeTransaction({ editor: activeEditor, transaction, nextState }) {
      const textChanged = trackedTextContentChanged(
        paragraphTextSnapshotFromState(activeEditor.state),
        paragraphTextSnapshotFromState(nextState),
      );
      const existingGuard = scrollGuardRef.current;
      const now = performance.now();
      const reuseExactGuard = Boolean(
        existingGuard?.preserveExact && existingGuard.expiresAt >= now,
      );
      const preserveExact = Boolean(
        transaction.getMeta(EDITOR_PRESERVE_SCROLL_META)
        || transaction.getMeta(SKIP_BLOCK_PARTITION_META)
        || transaction.getMeta('blockStateTransition')
        || (transaction.docChanged && !textChanged),
      );
      scrollGuardRef.current = {
        position: reuseExactGuard
          ? existingGuard.position
          : captureEditorScrollPosition(),
        preserveExact: preserveExact || reuseExactGuard,
        expiresAt: reuseExactGuard ? existingGuard.expiresAt : now + 240,
      };
    },
    onTransaction() {
      scheduleGuardedEditorScrollRestore();
    },
    onUpdate({ editor: activeEditor, transaction }) {
      const previousTextSnapshot = paragraphTextSnapshotRef.current;
      const suppressProgrammaticPartition = suppressProgrammaticPartitionRef.current;
      if (suppressProgrammaticUpdateRef.current) {
        suppressProgrammaticUpdateRef.current = false;
        paragraphTextSnapshotRef.current = paragraphTextSnapshot(activeEditor);
        suppressProgrammaticPartitionRef.current = false;
        return;
      }
      normalizeEditorBlockNodes(activeEditor, document?.id);
      const suppressBlockUiActivation = Boolean(
        suppressEditedStatusResetRef.current
        || transaction.getMeta('blockSelectionDeactivation'),
      );
      const skipEditedStatusReset = suppressBlockUiActivation;
      const normalizedJson = reconcileEditorBlocks(
        activeEditor,
        paragraphTextSnapshotRef.current,
        document?.id,
        { skipEditedStatusReset }
      );
      suppressEditedStatusResetRef.current = false;
      if (
        !suppressBlockUiActivation
        && hasUnfinishedBlocks(collectTrackedBlocks(activeEditor.state))
      ) {
        activeEditor.storage.blockSelectionDecoration.active = true;
      }
      const info = selectedParagraphInfo(activeEditor);
      scheduleBlockFrameSync(activeEditor);
      const snapshot = createEditorSnapshot(activeEditor);
      const nextTextSnapshot = paragraphTextSnapshot(activeEditor);
      const changedTextBlockIds = new Set([
        ...Array.from(previousTextSnapshot.keys()).filter((
          blockId,
        ) => previousTextSnapshot.get(blockId) !== nextTextSnapshot.get(blockId)),
        ...Array.from(nextTextSnapshot.keys()).filter((
          blockId,
          ) => previousTextSnapshot.get(blockId) !== nextTextSnapshot.get(blockId)),
      ]);
      const textContentChanged = trackedTextContentChanged(
        previousTextSnapshot,
        nextTextSnapshot,
      );
      const mutationKind = transaction.getMeta('workspaceMutationKind')
        ?? (transaction.getMeta('blockStateTransition')
          ? 'block-status'
          : textContentChanged
            ? 'text'
            : 'formatting');
      callbacksRef.current.onChange?.({
        ...snapshot,
        contentJson: normalizedJson,
        activeBlock: info,
        mutationKind,
      });
      callbacksRef.current.onActiveBlockChange?.(info);
      if (
        transaction.getMeta('blockStateTransition') === 'select'
        && info.blockId
      ) {
        callbacksRef.current.onBlockStatusChange?.({
          blockId: info.blockId,
          status: 'processing',
          replacementText: null,
          changeSource: 'none',
          ...snapshot,
        });
      }
      paragraphTextSnapshotRef.current = nextTextSnapshot;

      if (
        transaction.docChanged
        && textContentChanged
        && changedTextBlockIds.size > 0
        && !transaction.getMeta('editorBlockPartition')
        && !transaction.getMeta('editorBlockNormalization')
        && !transaction.getMeta('editorStructuralSelection')
        && !transaction.getMeta(SKIP_BLOCK_PARTITION_META)
        && !suppressProgrammaticPartition
      ) {
        const affectedBlockId = changedTextBlockIds.has(info.blockId)
          ? info.blockId
          : Array.from(changedTextBlockIds).find((blockId) => nextTextSnapshot.has(blockId));
        clearTimeout(blockPartitionTimerRef.current);
        if (affectedBlockId) {
          blockPartitionTimerRef.current = setTimeout(() => {
            blockPartitionTimerRef.current = null;
            repartitionAffectedEditorBlock(activeEditor, document?.id, affectedBlockId);
          }, 120);
        }
      }
      suppressProgrammaticPartitionRef.current = false;
    },
    onSelectionUpdate({ editor: activeEditor }) {
      activateSelectedEditorBlock(activeEditor);
      const info = selectedParagraphInfo(activeEditor);
      scheduleBlockFrameSync(activeEditor);
      callbacksRef.current.onActiveBlockChange?.(info);
    },
  }, [document?.id]);

  useEffect(() => {
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    const info = selectedParagraphInfo(editor);
    scheduleBlockFrameSync(editor);
    onActiveBlockChange?.(info);
  }, [editor, document?.id, onActiveBlockChange]);

  useLayoutEffect(() => {
    if (!initialScrollPosition || !paperScrollRef.current) return undefined;
    let secondFrame = null;
    const restore = () => {
      if (paperScrollRef.current) {
        paperScrollRef.current.scrollTop = Number(initialScrollPosition.top) || 0;
        paperScrollRef.current.scrollLeft = Number(initialScrollPosition.left) || 0;
      }
      window.scrollTo(
        Number(initialScrollPosition.windowX) || 0,
        Number(initialScrollPosition.windowY) || 0,
      );
    };
    restore();
    const firstFrame = requestAnimationFrame(() => {
      restore();
      secondFrame = requestAnimationFrame(restore);
    });
    const timer = setTimeout(() => {
      restore();
      onInitialScrollRestored?.();
    }, 180);
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
  }, [editor, document?.id, initialScrollPosition]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    editor.storage.analysisPhraseDecoration.highlights = Array.isArray(analysisHighlights)
      ? analysisHighlights
      : EMPTY_ANALYSIS_HIGHLIGHTS;
    const transaction = editor.state.tr
      .setMeta('analysisPhraseDecoration', true)
      .setMeta('addToHistory', false);
    editor.view.dispatch(transaction);
  }, [editor, analysisHighlights]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.storage.nlpIssueDecoration.issues = Array.isArray(nlpIssues)
      ? nlpIssues
      : EMPTY_NLP_ISSUES;
    editor.view.dispatch(editor.state.tr
      .setMeta('nlpIssueDecoration', true)
      .setMeta('addToHistory', false)
      .setMeta(EDITOR_PRESERVE_SCROLL_META, true));
  }, [editor, nlpIssues]);

  useEffect(() => () => {
    clearTimeout(blockPartitionTimerRef.current);
    clearTimeout(scrollGuardTimerRef.current);
    cancelScheduledAnimationFrame(frameSyncRafRef, cancelAnimationFrame);
    if (scrollGuardRafRef.current !== null) {
      cancelAnimationFrame(scrollGuardRafRef.current);
      scrollGuardRafRef.current = null;
    }
    scrollGuardTimerRef.current = null;
    scrollGuardRef.current = null;
  }, [document?.id]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !pageRef.current) return undefined;

    const refreshFrame = () => scheduleBlockFrameSync(editor);
    const observer = new ResizeObserver(refreshFrame);
    observer.observe(editor.view.dom);
    window.addEventListener('resize', refreshFrame);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refreshFrame);
    };
  }, [editor, document?.id]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !pageRef.current) return undefined;
    const eventRoot = pageRef.current;

    const setHoveredBlock = (blockId) => {
      if (hoveredBlockIdRef.current === blockId) return;
      hoveredBlockIdRef.current = blockId;
      eventRoot.querySelectorAll(':scope > .block-status-frame').forEach((frame) => {
        frame.classList.toggle('is-hovered', frame.dataset.blockId === blockId);
      });
    };
    const handlePointerMove = (event) => {
      const block = blockElementAtPoint(
        editor,
        eventRoot,
        event.target,
        event.clientX,
        event.clientY,
      );
      setHoveredBlock(block?.dataset.blockId ?? null);
    };
    const clearHoveredBlock = () => setHoveredBlock(null);

    eventRoot.addEventListener('pointermove', handlePointerMove);
    eventRoot.addEventListener('pointerleave', clearHoveredBlock);
    return () => {
      eventRoot.removeEventListener('pointermove', handlePointerMove);
      eventRoot.removeEventListener('pointerleave', clearHoveredBlock);
      hoveredBlockIdRef.current = null;
    };
  }, [editor, document?.id]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;

    const handleEditorBlockClick = (event) => {
      const button = event.target.closest?.('[data-selected-block-action]');
      if (button && !button.disabled) {
        const action = button.dataset.selectedBlockAction;
        const targetBlockId = button.dataset.selectedBlockId ?? null;
        if (action === 'skip') setSelectedBlockStatus('skipped', targetBlockId);
        if (action === 'complete') setSelectedBlockStatus('processed', targetBlockId);
        return;
      }

      const clickedBlock = blockElementAtPoint(
        editor,
        eventRoot,
        event.target,
        event.clientX,
        event.clientY,
      );
      if (!clickedBlock) {
        deactivateSelectedEditorBlock(editor);
        const info = selectedParagraphInfo(editor);
        scheduleBlockFrameSync(editor);
        onActiveBlockChange?.(info);
        return;
      }

      editor.storage.blockSelectionDecoration.active = true;
      const clickedBlockId = clickedBlock.dataset.blockId;
      if (selectedParagraphFromState(editor.state)?.blockId !== clickedBlockId) {
        const targetBlock = collectTrackedBlocks(editor.state).find(
          (block) => block.blockId === clickedBlockId,
        );
        if (targetBlock) {
          editor
            .chain()
            .setTextSelection(targetBlock.pos + 1)
            .focus(undefined, { scrollIntoView: false })
            .run();
        }
      }
      editor.view.dispatch(editor.state.tr
        .setMeta('blockSelectionActivation', true)
        .setMeta('addToHistory', false));
      activateSelectedEditorBlock(editor);
      const info = selectedParagraphInfo(editor);
      scheduleBlockFrameSync(editor);
      onActiveBlockChange?.(info);
    };

    const eventRoot = pageRef.current ?? editor.view.dom;
    eventRoot.addEventListener('click', handleEditorBlockClick);
    return () => eventRoot.removeEventListener('click', handleEditorBlockClick);
  }, [editor, onActiveBlockChange, onBlockStatusChange]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const eventRoot = pageRef.current ?? editor.view.dom;

    const closeMenu = () => setOrderedListMenu(null);
    const openOrderedListMenu = (event, listElement) => {
      if (!listElement || !editor.view.dom.contains(listElement)) return;
      const listPos = orderedListPositionForElement(editor, listElement);
      if (listPos == null) return;
      event.preventDefault();
      setOrderedListMenu({
        left: Math.min(event.clientX, window.innerWidth - 190),
        top: Math.min(event.clientY, window.innerHeight - 64),
        listPos,
      });
    };
    const handleOrderedListContextMenu = (event) => {
      openOrderedListMenu(event, event.target.closest?.('ol'));
    };
    const handleOrderedListMarkerClick = (event) => {
      if (event.button !== 0) return;
      const listItem = event.target.closest?.('li');
      if (!listItem || !isOrderedListMarkerClick(event, listItem)) return;
      openOrderedListMenu(event, listItem.closest('ol'));
    };

    eventRoot.addEventListener('contextmenu', handleOrderedListContextMenu);
    eventRoot.addEventListener('click', handleOrderedListMarkerClick);
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      eventRoot.removeEventListener('contextmenu', handleOrderedListContextMenu);
      eventRoot.removeEventListener('click', handleOrderedListMarkerClick);
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [editor]);

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

        const overrideValue = node.attrs.formatOverrides;
        const overrides = new Set(Array.isArray(overrideValue)
          ? overrideValue
          : Object.keys(overrideValue ?? {}));
        const synchronizedAttrs = Object.fromEntries(
          Object.entries(attrs).filter(([key]) => !overrides.has(key)),
        );
        const nextAttrs = { ...node.attrs, ...synchronizedAttrs };
        const didChange = Object.entries(synchronizedAttrs).some(([key, value]) => node.attrs[key] !== value);
        if (!didChange) return;

        tr.setNodeMarkup(pos, undefined, nextAttrs);
        changed = true;
      });

      if (changed) {
        tr
          .setMeta('addToHistory', false)
          .setMeta(EDITOR_PRESERVE_SCROLL_META, true);
        suppressProgrammaticUpdateRef.current = true;
        dispatch?.(tr);
      }
      return true;
    });
  }, [editor, styleSignature, normalizedStyle]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !pageRef.current) return undefined;
    let timer = null;
    let measuring = false;

    const measureAtSafeBlocks = () => {
      if (measuring || editor.isDestroyed) return;
      measuring = true;
      const pageStyles = getComputedStyle(pageRef.current);
      const availableHeight = Math.max(
        240,
        (Number.parseFloat(pageStyles.getPropertyValue('--a4-page-height')) || A4_PAGE_HEIGHT_PX)
          - (Number.parseFloat(pageStyles.paddingTop) || 0)
          - (Number.parseFloat(pageStyles.paddingBottom) || 0),
      );
      const positions = [];
      let used = 0;
      editor.state.doc.forEach((node, offset) => {
        const dom = editor.view.nodeDOM(offset);
        const height = dom instanceof HTMLElement
          ? dom.getBoundingClientRect().height
          : 0;
        if (node.type.name === 'pageBreak') {
          if (!positions.includes(offset)) positions.push(offset);
          used = 0;
          return;
        }
        if (used > 0 && height > 0 && used + height > availableHeight) {
          positions.push(offset);
          used = height;
        } else {
          used += height;
        }
      });
      const current = PAGINATION_PLUGIN_KEY.getState(editor.state) ?? [];
      if (JSON.stringify(current) !== JSON.stringify(positions)) {
        editor.view.dispatch(editor.state.tr
          .setMeta(PAGINATION_META, positions)
          .setMeta('addToHistory', false));
      }
      setPageCount(positions.length + 1);
      measuring = false;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(measureAtSafeBlocks, 120);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(editor.view.dom);
    observer.observe(pageRef.current);
    window.addEventListener('resize', schedule);
    editor.on('transaction', schedule);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      editor.off('transaction', schedule);
    };
  }, [editor, document?.id, styleSignature]);

  const pageStyle = {
    '--a4-page-height': `${A4_PAGE_HEIGHT_PX}px`,
    '--a4-page-count': pageCount,
    '--a4-paper-height': `${
      (pageCount * A4_PAGE_HEIGHT_PX) + ((pageCount - 1) * PAGE_GUTTER_HEIGHT_PX)
    }px`,
    '--paper-page-gutter-height': `${PAGE_GUTTER_HEIGHT_PX}px`,
    '--paper-margin-top': cssLength(normalizedStyle.marginTop, '1in'),
    '--paper-margin-right': cssLength(normalizedStyle.marginRight, '1in'),
    '--paper-margin-bottom': cssLength(normalizedStyle.marginBottom, '1in'),
    '--paper-margin-left': cssLength(normalizedStyle.marginLeft, '1in'),
    '--paper-font-family': normalizedStyle.fontFamily,
    '--paper-line-height': normalizedStyle.lineHeight,
    '--paper-text-indent': normalizedStyle.textIndent,
    '--paper-font-size': normalizedStyle.fontSize,
    '--reference-line-height': (
      normalizedStyle.referenceList?.lineHeight
      || normalizedStyle.bibliography?.lineHeight
      || normalizedStyle.lineHeight
    ),
    '--reference-hanging-indent': (
      normalizedStyle.referenceList?.hangingIndent
      || normalizedStyle.bibliography?.hangingIndent
      || '0.5in'
    ),
    '--reference-entry-spacing-after': (
      normalizedStyle.referenceList?.entrySpacingAfter
      || normalizedStyle.bibliography?.entrySpacingAfter
      || '0in'
    ),
    '--blockquote-line-height': normalizedStyle.blockQuote?.lineHeight || normalizedStyle.lineHeight,
    '--blockquote-left-indent': normalizedStyle.blockQuote?.leftIndent || '0.5in',
    '--footnote-line-height': normalizedStyle.footnote?.lineHeight || '1.0',
    '--footnote-first-line-indent': normalizedStyle.footnote?.firstLineIndent || '0.5in',
    ...pageNumberPosition(normalizedStyle.pageNumber),
  };

  function applyCurrentBlockStatus({
    status,
    replacementText = null,
    targetBlockId = null,
    changeSource = replacementText === null ? 'none' : 'ai-replacement',
  } = {}) {
    if (!editor || editor.isDestroyed) return;

    const paperScrollPosition = {
      top: paperScrollRef.current?.scrollTop ?? 0,
      left: paperScrollRef.current?.scrollLeft ?? 0,
      windowX: window.scrollX,
      windowY: window.scrollY,
    };
    let updatedBlockId = selectedParagraphInfo(editor).blockId;
    let nextLocalProcessingId = null;
    let applied = false;

    clearTimeout(blockPartitionTimerRef.current);
    blockPartitionTimerRef.current = null;
    suppressEditedStatusResetRef.current = true;
    suppressProgrammaticPartitionRef.current = true;
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
        editor.storage.blockSelectionDecoration.active = true;
        paragraphs.forEach((paragraph) => {
          if (paragraph.pos === target.pos) {
            if (paragraph.status === 'processing') return;
            tr.setNodeMarkup(paragraph.pos, undefined, {
              ...paragraph.node.attrs,
              status: 'processing',
              resumeStatus: normalizeResumeStatus(paragraph.status),
              processingBaselineText: paragraph.text,
              changeSource: 'none',
            });
            return;
          }
          if (paragraph.status !== 'processing') return;
          const baseline = String(paragraph.attrs.processingBaselineText ?? paragraph.text);
          const unchanged = paragraph.text === baseline;
          tr.setNodeMarkup(paragraph.pos, undefined, {
            ...paragraph.node.attrs,
            status: unchanged
              ? normalizeResumeStatus(paragraph.attrs.resumeStatus)
              : 'unprocessed',
            resumeStatus: null,
            processingBaselineText: null,
            changeSource: unchanged ? 'none' : 'manual',
          });
        });
      } else if (status === 'processed' || status === 'skipped') {
        const nextProcessing = chooseNextUnfinishedBlock(paragraphs, target.blockId);
        nextLocalProcessingId = nextProcessing?.blockId ?? null;
        editor.storage.blockSelectionDecoration.active = Boolean(nextProcessing);
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
          if (paragraph.pos === target.pos) {
            nextAttrs.resumeStatus = null;
            nextAttrs.processingBaselineText = null;
            nextAttrs.changeSource = normalizeChangeSource(changeSource);
          } else if (nextProcessing && paragraph.blockId === nextProcessing.blockId) {
            nextAttrs.resumeStatus = 'unprocessed';
            nextAttrs.processingBaselineText = paragraph.text;
            nextAttrs.changeSource = 'none';
          } else if (paragraph.status === 'processing') {
            const baseline = String(paragraph.attrs.processingBaselineText ?? paragraph.text);
            const unchanged = paragraph.text === baseline;
            nextAttrs.status = unchanged
              ? normalizeResumeStatus(paragraph.attrs.resumeStatus)
              : 'unprocessed';
            nextAttrs.resumeStatus = null;
            nextAttrs.processingBaselineText = null;
            nextAttrs.changeSource = unchanged ? 'none' : 'manual';
            nextStatus = nextAttrs.status;
          }
          if (paragraph.pos === target.pos && replacementText !== null) {
            nextAttrs.length = countCharacters(replacementText);
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

      tr.setMeta(SKIP_BLOCK_PARTITION_META, true);
      tr.setMeta(
        'workspaceMutationKind',
        replacementText === null ? 'block-status' : 'text',
      );
      if (replacementText === null) tr.setMeta('addToHistory', false);
      dispatch?.(tr);
      applied = true;
      return true;
    });
    if (!applied) {
      suppressEditedStatusResetRef.current = false;
      suppressProgrammaticPartitionRef.current = false;
    }

    const snapshot = createEditorSnapshot(editor);
    paragraphTextSnapshotRef.current = paragraphTextSnapshot(editor);
    const restoreCapturedScroll = () => {
      if (paperScrollRef.current) {
        paperScrollRef.current.scrollTop = paperScrollPosition.top;
        paperScrollRef.current.scrollLeft = paperScrollPosition.left;
      }
      window.scrollTo(paperScrollPosition.windowX, paperScrollPosition.windowY);
    };
    restoreCapturedScroll();
    window.requestAnimationFrame(restoreCapturedScroll);
    if (applied && updatedBlockId) {
      onBlockStatusChange?.({
        blockId: updatedBlockId,
        status,
        replacementText,
        changeSource,
        nextProcessingBlockId: nextLocalProcessingId,
        paperScrollPosition,
        ...snapshot,
      });
    }
    return applied ? snapshot : null;
  }

  useImperativeHandle(ref, () => ({
    applyCurrentBlockStatus,
    applyCitationPatch: ({ anchor, replacementText } = {}) => {
      if (!editor || editor.isDestroyed || !anchor?.blockId) return null;
      const targetRange = citationTextRange(editor.state.doc, anchor);
      if (!targetRange) return null;

      let applied = false;
      editor.commands.command(({ state, tr, dispatch }) => {
        const currentText = state.doc.textBetween(
          targetRange.from,
          targetRange.to,
          '',
          '',
        );
        if (
          typeof anchor.originalText === 'string'
          && currentText !== anchor.originalText
        ) return false;

        tr
          .insertText(String(replacementText ?? ''), targetRange.from, targetRange.to)
          .setMeta(SKIP_BLOCK_PARTITION_META, true)
          .setMeta(EDITOR_PRESERVE_SCROLL_META, true)
          .setMeta('workspaceMutationKind', 'citation');
        applied = true;
        dispatch?.(tr);
        return true;
      });
      return applied ? createEditorSnapshot(editor) : null;
    },
    focusCitationAnchor: (anchor) => {
      if (!editor || editor.isDestroyed || !anchor?.blockId) return false;
      const targetRange = citationTextRange(editor.state.doc, anchor);
      if (!targetRange) return false;

      const applyCitationSelection = () => {
        if (editor.isDestroyed) return false;
        editor.storage.blockSelectionDecoration.active = true;
        const applied = editor
          .chain()
          .focus(undefined, { scrollIntoView: false })
          .setTextSelection(targetRange)
          .command(({ tr }) => {
            tr.setMeta('blockSelectionActivation', true);
            tr.setMeta('addToHistory', false);
            return true;
          })
          .run();
        if (!applied) return false;

        activateSelectedEditorBlock(editor);
        const info = selectedParagraphInfo(editor);
        scheduleBlockFrameSync(editor);
        callbacksRef.current.onActiveBlockChange?.(info);
        return true;
      };

      if (!applyCitationSelection()) return false;
      window.requestAnimationFrame(() => {
        if (!applyCitationSelection()) return;
        const blockElement = Array.from(
          editor.view.dom.querySelectorAll('.doc-block[data-block-id]'),
        ).find((element) => element.dataset.blockId === anchor.blockId);
        const scrollContainer = paperScrollRef.current;
        if (!blockElement || !scrollContainer) return;
        const blockRect = blockElement.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const centeredTop = (
          scrollContainer.scrollTop
          + blockRect.top
          - containerRect.top
          - Math.max(0, (scrollContainer.clientHeight - blockRect.height) / 2)
        );
        scrollContainer.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: 'smooth',
        });
      });
      return true;
    },
    applyBlockNlpResult: (blockId, response) => {
      if (!editor || editor.isDestroyed || !blockId || !response?.nlp) return null;
      let applied = false;
      editor.commands.command(({ state, tr, dispatch }) => {
        state.doc.descendants((node, pos) => {
          if (
            applied
            || !isTrackedTextBlockNode(node)
            || node.attrs.blockId !== blockId
          ) return;
          tr.setNodeMarkup(pos, undefined, applyBlockNlpAttrs(node.attrs, response));
          applied = true;
        });
        if (!applied) return false;
        tr
          .setMeta('addToHistory', false)
          .setMeta(SKIP_BLOCK_PARTITION_META, true)
          .setMeta(EDITOR_PRESERVE_SCROLL_META, true)
          .setMeta('workspaceMutationKind', 'nlp-metadata');
        suppressProgrammaticUpdateRef.current = true;
        dispatch?.(tr);
        return true;
      });
      if (!applied) return null;
      const snapshot = createEditorSnapshot(editor);
      callbacksRef.current.onChange?.({
        ...snapshot,
        mutationKind: 'nlp-metadata',
      });
      return snapshot;
    },
    getScrollPosition: () => ({
      top: paperScrollRef.current?.scrollTop ?? 0,
      left: paperScrollRef.current?.scrollLeft ?? 0,
      windowX: window.scrollX,
      windowY: window.scrollY,
    }),
    restoreScrollPosition: (position) => {
      if (!position) return;
      if (paperScrollRef.current) {
        paperScrollRef.current.scrollTop = Number(position.top) || 0;
        paperScrollRef.current.scrollLeft = Number(position.left) || 0;
      }
      window.scrollTo(Number(position.windowX) || 0, Number(position.windowY) || 0);
    },
    getSnapshot: () => createEditorSnapshot(editor),
  }), [editor, onBlockStatusChange, normalizedStyle]);

  function setSelectedBlockStatus(status, targetBlockId = null) {
    const blockId = targetBlockId ?? selectedParagraphInfo(editor).blockId;
    applyCurrentBlockStatus({ status, targetBlockId: blockId });
  }

  function restartOrderedListNumbering() {
    if (!orderedListMenu || !editor || editor.isDestroyed) return;
    editor.commands.command(({ state, tr, dispatch }) => {
      const list = state.doc.nodeAt(orderedListMenu.listPos);
      if (list?.type.name !== 'orderedList') return false;
      tr.setNodeMarkup(orderedListMenu.listPos, undefined, {
        ...list.attrs,
        start: 1,
        restartNumbering: true,
      });
      tr.setMeta('orderedListRestart', true);
      tr.setMeta(SKIP_BLOCK_PARTITION_META, true);
      dispatch?.(tr);
      return true;
    });
    setOrderedListMenu(null);
  }

  return (
    <div
      className="document-editor"
      data-academic-style={document?.academic_style || DEFAULT_UPLOAD_ACADEMIC_STYLE}
      data-block-visuals={blockVisualsVisible ? 'on' : 'off'}
    >
      <EditorToolbar
        editor={editor}
        normalTextStyle={normalizedStyle}
        blockVisualsVisible={blockVisualsVisible}
        onToggleBlockVisuals={() => setBlockVisualsVisible((visible) => !visible)}
        pureMode={pureMode}
        onTogglePureMode={onTogglePureMode}
        onSave={onSave}
        onExport={onExport}
        saveDisabled={saveDisabled}
        saving={saving}
        exporting={exporting}
      />
      <div ref={paperScrollRef} className="paper-scroll">
        <A4EditorPage
          ref={pageRef}
          pageCount={pageCount}
          pageNumberPosition={normalizedStyle.pageNumber}
          style={pageStyle}
        >
          <EditorContent editor={editor} />
        </A4EditorPage>
      </div>
      {orderedListMenu ? (
        <div
          className="editor-context-menu"
          role="menu"
          style={{ left: orderedListMenu.left, top: orderedListMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={restartOrderedListNumbering}>
            Renumber from 1
          </button>
        </div>
      ) : null}
    </div>
  );
});

export default DocumentEditor;
