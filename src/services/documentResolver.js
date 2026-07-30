import path from 'node:path';
import mammoth from 'mammoth';
import mammothOfficeXmlReader from 'mammoth/lib/docx/office-xml-reader.js';
import mammothUnzip from 'mammoth/lib/unzip.js';
import { parseFragment } from 'parse5';
import { cleanExtractedBlocks } from '../lib/documentCleanup/index.js';

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['.txt', '.md', '.docx']);

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'td', 'th']);
const MARK_TAGS = new Map([
  ['strong', 'bold'],
  ['b', 'bold'],
  ['em', 'italic'],
  ['i', 'italic'],
  ['u', 'underline'],
  ['code', 'code'],
]);

const DOCX_ALIGNMENT_MAP = new Map([
  ['left', 'left'],
  ['start', 'left'],
  ['center', 'center'],
  ['right', 'right'],
  ['end', 'right'],
  ['both', 'justify'],
  ['justify', 'justify'],
  ['distribute', 'justify'],
  ['thaidistribute', 'justify'],
]);

const EMPTY_DOCX_STYLES = {
  defaultParagraphStyleId: null,
  defaultParagraphStyle: {
    alignment: null,
    indent: {},
    lineHeight: null,
  },
  defaultRunStyle: {},
  paragraphStyles: new Map(),
  resolvedParagraphStyles: new Map(),
};

function resolverError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw resolverError('The uploaded text file is not valid UTF-8.');
  }
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n');
}

function textBlock(text, sourceType = 'paragraph', attrs = {}, content = null) {
  const inlineContent = String(text ?? '').split(/(\n)/).filter(Boolean).map((part) => (
    part === '\n' ? { type: 'hardBreak' } : { type: 'text', text: part }
  ));
  return {
    sourceType,
    text,
    attrs: { sourceType, ...attrs },
    content: content ?? inlineContent,
  };
}

function ensureBlocks(blocks) {
  const normalized = blocks.filter((block) => block.text.trim());
  if (!normalized.length) {
    throw resolverError('The uploaded document does not contain any text blocks.');
  }
  return normalized;
}

function endsCompleteSentence(value) {
  return /[.!?][\p{Pe}"'’”]*$/u.test(String(value ?? '').trim());
}

function beginsAsContinuation(value) {
  const text = String(value ?? '').trim();
  return /^[\p{Ll},.;:!?)}\]]/u.test(text)
    || /^(?:and|but|nor|or|so|yet|which|that|because|while|whereas)\b/i.test(text);
}

function mergeContinuationBlocks(left, right) {
  const leftContent = Array.isArray(left.content) ? left.content : [];
  const rightContent = Array.isArray(right.content) ? right.content : [];
  return {
    ...left,
    text: `${left.text}\n${right.text}`,
    content: [
      ...leftContent,
      { type: 'hardBreak' },
      ...rightContent,
    ],
  };
}

export function coalesceContinuationBlocks(blocks) {
  const output = [];
  let continuationOpen = false;

  for (const block of blocks) {
    const previous = output.at(-1);
    const compatible = previous?.sourceType === 'paragraph' && block.sourceType === 'paragraph';
    const previousIncomplete = compatible && !endsCompleteSentence(previous.text);
    const currentShort = Array.from(String(block.text ?? '')).length <= 80;
    const currentContinuation = beginsAsContinuation(block.text);
    const shouldMerge = compatible && (
      continuationOpen
      || currentContinuation
      || (previousIncomplete && (
        Array.from(String(previous.text ?? '')).length >= 80
        || currentShort
      ))
    );

    if (!shouldMerge) {
      output.push(block);
      continuationOpen = false;
      continue;
    }

    output[output.length - 1] = mergeContinuationBlocks(previous, block);
    continuationOpen = currentShort
      || (!endsCompleteSentence(block.text) && (
        currentContinuation
        || Array.from(String(block.text ?? '')).length < 240
      ));
  }

  return output;
}

export function extractTextBlocks(text) {
  const blocks = normalizeText(text)
    .split(/\n[^\S\n]*\n+/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => textBlock(section));
  return ensureBlocks(cleanExtractedBlocks(blocks));
}

function markdownMetadata(line) {
  const heading = /^(#{1,6})\s+/.exec(line);
  if (heading) return { sourceType: 'heading', attrs: { level: heading[1].length } };
  if (/^>\s?/.test(line)) return { sourceType: 'blockquote', attrs: {} };
  if (/^[-+*]\s+/.test(line)) return { sourceType: 'bulletListItem', attrs: {} };
  const ordered = /^(\d+)[.)]\s+/.exec(line);
  if (ordered) return { sourceType: 'orderedListItem', attrs: { order: Number(ordered[1]) } };
  return { sourceType: 'paragraph', attrs: {} };
}

export function extractMarkdownBlocks(text) {
  const lines = normalizeText(text).split('\n');
  const blocks = [];
  let fencedLines = null;
  let fenceMarker = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const fence = /^(```+|~~~+)/.exec(line)?.[1] ?? null;
    if (fencedLines) {
      fencedLines.push(rawLine);
      if (fence && fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) {
        blocks.push(textBlock(fencedLines.join('\n'), 'codeBlock', {}, [
          { type: 'text', text: fencedLines.join('\n'), marks: [{ type: 'code' }] },
        ]));
        fencedLines = null;
        fenceMarker = null;
      }
      continue;
    }

    if (fence) {
      fencedLines = [rawLine];
      fenceMarker = fence;
      continue;
    }
    if (!line) continue;
    const metadata = markdownMetadata(line);
    blocks.push(textBlock(line, metadata.sourceType, metadata.attrs));
  }

  if (fencedLines) {
    blocks.push(textBlock(fencedLines.join('\n'), 'codeBlock', { unclosed: true }, [
      { type: 'text', text: fencedLines.join('\n'), marks: [{ type: 'code' }] },
    ]));
  }

  return ensureBlocks(blocks);
}

function sourceTypeForTag(tagName) {
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'li') return 'listItem';
  if (tagName === 'blockquote') return 'blockquote';
  if (tagName === 'td' || tagName === 'th') return 'tableCell';
  return 'paragraph';
}

function attrsForTag(tagName) {
  if (/^h[1-6]$/.test(tagName)) return { level: Number(tagName.slice(1)) };
  if (tagName === 'li') return { textIndent: '0.25in' };
  return {};
}

function attributeValue(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value ?? null;
}

function mergeFormatAttrs(baseAttrs, formatAttrs) {
  if (!formatAttrs) return baseAttrs;
  const formatOverrides = [
    ...(baseAttrs.formatOverrides ?? []),
    ...(formatAttrs.formatOverrides ?? []),
  ];
  return {
    ...baseAttrs,
    ...formatAttrs,
    ...(formatOverrides.length
      ? { formatOverrides: [...new Set(formatOverrides)] }
      : {}),
  };
}

function attrsForHtmlBlock(tagName, node, docxParagraphFormats) {
  const baseAttrs = attrsForTag(tagName);
  const formatIndex = Number.parseInt(attributeValue(node, 'data-docx-paragraph'), 10);
  if (!Number.isInteger(formatIndex)) return baseAttrs;
  return mergeFormatAttrs(baseAttrs, docxParagraphFormats[formatIndex]);
}

function docxAlignment(value) {
  return DOCX_ALIGNMENT_MAP.get(String(value ?? '').toLowerCase()) ?? null;
}

function docxTwipsToInches(value) {
  if (value == null || String(value).trim() === '') return null;
  const twips = Number(value);
  if (!Number.isFinite(twips)) return null;
  const inches = twips / 1440;
  const supportedIndents = [0, 0.25, 0.5];
  const roundedIndent = supportedIndents.find(
    (indent) => inches <= indent + Number.EPSILON,
  ) ?? supportedIndents.at(-1);
  return `${roundedIndent}in`;
}

function docxStyleIndent(element) {
  const attributes = element.firstOrEmpty('w:ind').attributes;
  return {
    start: attributes['w:start'] ?? attributes['w:left'] ?? null,
    end: attributes['w:end'] ?? attributes['w:right'] ?? null,
    firstLine: attributes['w:firstLine'] ?? null,
    hanging: attributes['w:hanging'] ?? null,
  };
}

function docxStyleLineHeight(element) {
  const attributes = element.firstOrEmpty('w:spacing').attributes;
  const line = Number(attributes['w:line']);
  if (!Number.isFinite(line) || line <= 0) return null;
  if ((attributes['w:lineRule'] ?? 'auto') !== 'auto') return null;
  return String(Math.round((line / 240) * 100) / 100);
}

function docxBooleanProperty(element, propertyName) {
  const property = element.children?.find((child) => child.name === propertyName);
  if (!property) return null;
  return !['0', 'false', 'off', 'none'].includes(
    String(property.attributes?.['w:val'] ?? '1').toLowerCase(),
  );
}

function docxRunStyle(element) {
  const fontAttributes = element.firstOrEmpty('w:rFonts').attributes;
  const halfPointSize = Number(element.firstOrEmpty('w:sz').attributes['w:val']);
  return {
    fontFamily: (
      fontAttributes['w:ascii']
      ?? fontAttributes['w:hAnsi']
      ?? fontAttributes['w:eastAsia']
      ?? fontAttributes['w:cs']
      ?? null
    ),
    fontSize: Number.isFinite(halfPointSize) && halfPointSize > 0
      ? `${halfPointSize / 2}pt`
      : null,
    bold: docxBooleanProperty(element, 'w:b'),
    italic: docxBooleanProperty(element, 'w:i'),
    underline: docxBooleanProperty(element, 'w:u'),
    strike: docxBooleanProperty(element, 'w:strike'),
  };
}

function mergeDocxRunStyles(inherited = {}, current = {}) {
  const merged = { ...inherited };
  for (const [key, value] of Object.entries(current)) {
    if (value != null) merged[key] = value;
  }
  return merged;
}

function docxNodeText(node) {
  if (node?.type === 'text') return node.value ?? '';
  return (node?.children ?? []).map(docxNodeText).join('');
}

function docxParagraphFontSize(paragraph, fallbackFontSize = null) {
  const fallback = Number.parseFloat(fallbackFontSize);
  const characterCounts = new Map();

  function visit(node) {
    if (node?.type === 'run') {
      const fontSize = Number.parseFloat(node.fontSize) || fallback;
      const characterCount = Array.from(docxNodeText(node)).length;
      if (Number.isFinite(fontSize) && fontSize > 0 && characterCount > 0) {
        characterCounts.set(
          fontSize,
          (characterCounts.get(fontSize) ?? 0) + characterCount,
        );
      }
      return;
    }
    for (const child of node?.children ?? []) visit(child);
  }

  visit(paragraph);
  const dominant = [...characterCounts.entries()].sort(
    ([leftSize, leftCount], [rightSize, rightCount]) => (
      rightCount - leftCount || rightSize - leftSize
    ),
  )[0]?.[0];
  return dominant ? `${dominant}pt` : null;
}

function docxParagraphStyle(element) {
  return {
    alignment: element.firstOrEmpty('w:jc').attributes['w:val'] ?? null,
    indent: docxStyleIndent(element),
    lineHeight: docxStyleLineHeight(element),
  };
}

async function readDocxParagraphStyles(buffer) {
  try {
    const docxFile = await mammothUnzip.openZip({ buffer });
    const root = await mammothOfficeXmlReader.readXmlFromZipFile(
      docxFile,
      'word/styles.xml',
    );
    if (!root?.getElementsByTagName) return EMPTY_DOCX_STYLES;

    const paragraphStyles = new Map();
    let defaultParagraphStyleId = null;
    const documentDefaults = root.firstOrEmpty('w:docDefaults');
    const defaultParagraphStyle = docxParagraphStyle(
      documentDefaults.firstOrEmpty('w:pPrDefault').firstOrEmpty('w:pPr'),
    );
    const defaultRunStyle = docxRunStyle(
      documentDefaults.firstOrEmpty('w:rPrDefault').firstOrEmpty('w:rPr'),
    );
    for (const element of root.getElementsByTagName('w:style')) {
      if (element.attributes['w:type'] !== 'paragraph') continue;
      const styleId = element.attributes['w:styleId'];
      if (!styleId || paragraphStyles.has(styleId)) continue;
      const paragraphProperties = element.firstOrEmpty('w:pPr');
      paragraphStyles.set(styleId, {
        basedOn: element.firstOrEmpty('w:basedOn').attributes['w:val'] ?? null,
        ...docxParagraphStyle(paragraphProperties),
        runStyle: docxRunStyle(element.firstOrEmpty('w:rPr')),
      });
      if (element.attributes['w:default'] === '1') {
        defaultParagraphStyleId = styleId;
      }
    }
    return {
      defaultParagraphStyleId,
      defaultParagraphStyle,
      defaultRunStyle,
      paragraphStyles,
      resolvedParagraphStyles: new Map(),
    };
  } catch {
    return EMPTY_DOCX_STYLES;
  }
}

function resolveDocxParagraphStyle(styleId, docxStyles, activeStyleIds = new Set()) {
  if (!styleId || activeStyleIds.has(styleId)) return null;
  const cached = docxStyles.resolvedParagraphStyles.get(styleId);
  if (cached) return cached;
  const style = docxStyles.paragraphStyles.get(styleId);
  if (!style) return null;

  const nextActiveStyleIds = new Set(activeStyleIds).add(styleId);
  const inherited = resolveDocxParagraphStyle(
    style.basedOn,
    docxStyles,
    nextActiveStyleIds,
  ) ?? {
    ...docxStyles.defaultParagraphStyle,
    runStyle: docxStyles.defaultRunStyle,
  };
  const indent = { ...(inherited.indent ?? {}) };
  for (const [key, value] of Object.entries(style.indent)) {
    if (value != null) indent[key] = value;
  }
  const resolved = {
    alignment: style.alignment ?? inherited.alignment ?? null,
    indent,
    lineHeight: style.lineHeight ?? inherited.lineHeight ?? null,
    runStyle: mergeDocxRunStyles(inherited.runStyle, style.runStyle),
  };
  docxStyles.resolvedParagraphStyles.set(styleId, resolved);
  return resolved;
}

function docxParagraphFormat(paragraph, docxStyles) {
  const attrs = {};
  const formatOverrides = [];
  const styleId = paragraph.styleId ?? docxStyles.defaultParagraphStyleId;
  const inheritedStyle = resolveDocxParagraphStyle(styleId, docxStyles) ?? {
    ...docxStyles.defaultParagraphStyle,
    runStyle: docxStyles.defaultRunStyle,
  };
  const textAlign = docxAlignment(
    paragraph.alignment ?? inheritedStyle.alignment,
  );
  const textIndent = docxTwipsToInches(
    paragraph.indent?.firstLine ?? inheritedStyle.indent?.firstLine,
  );
  const fontSize = docxParagraphFontSize(
    paragraph,
    inheritedStyle.runStyle?.fontSize,
  );

  if (textAlign) {
    attrs.textAlign = textAlign;
    formatOverrides.push('textAlign');
  }
  if (textIndent) {
    attrs.textIndent = textIndent;
    formatOverrides.push('textIndent');
  }
  if (inheritedStyle.lineHeight) {
    attrs.lineHeight = inheritedStyle.lineHeight;
    formatOverrides.push('lineHeight');
  }
  if (inheritedStyle.runStyle?.fontFamily) {
    attrs.fontFamily = inheritedStyle.runStyle.fontFamily;
    formatOverrides.push('fontFamily');
  }
  if (fontSize) {
    attrs.fontSize = fontSize;
    formatOverrides.push('fontSize');
  }
  if (docxHeadingLevel(paragraph)) {
    attrs.preserveHeadingStyle = true;
  }
  if (formatOverrides.length) attrs.formatOverrides = formatOverrides;
  return attrs;
}

function applyDocxParagraphRunStyle(paragraph, docxStyles) {
  const styleId = paragraph.styleId ?? docxStyles.defaultParagraphStyleId;
  const inheritedStyle = resolveDocxParagraphStyle(styleId, docxStyles) ?? {
    runStyle: docxStyles.defaultRunStyle,
  };
  const runStyle = inheritedStyle.runStyle ?? {};

  return {
    ...paragraph,
    children: (paragraph.children ?? []).map((child) => {
      if (child.type !== 'run') return child;
      return {
        ...child,
        isBold: child.isBold || Boolean(runStyle.bold),
        isItalic: child.isItalic || Boolean(runStyle.italic),
        isUnderline: child.isUnderline || Boolean(runStyle.underline),
        isStrikethrough: child.isStrikethrough || Boolean(runStyle.strike),
        font: child.font || runStyle.fontFamily || null,
        fontSize: child.fontSize || (
          Number.parseFloat(runStyle.fontSize) || null
        ),
      };
    }),
  };
}

function docxHeadingLevel(paragraph) {
  for (const value of [paragraph.styleId, paragraph.styleName]) {
    const match = /^heading\s*([1-6])$/i.exec(String(value ?? '').trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function docxHtmlPath(paragraph, formatIndex) {
  const marker = `[data-docx-paragraph='${formatIndex}']`;
  if (paragraph.numbering) {
    const level = Math.max(0, Math.min(8, Number(paragraph.numbering.level) || 0));
    const ancestors = Array.from({ length: level }, () => 'ul|ol > li > ').join('');
    const listTag = paragraph.numbering.isOrdered ? 'ol' : 'ul';
    return `${ancestors}${listTag} > li${marker}:fresh`;
  }
  const headingLevel = docxHeadingLevel(paragraph);
  return `${headingLevel ? `h${headingLevel}` : 'p'}${marker}:fresh`;
}

function docxConversionOptions(docxParagraphFormats, docxStyles) {
  const styleMap = [];
  let paragraphIndex = 0;
  return {
    styleMap,
    transformDocument: mammoth.transforms.paragraph((paragraph) => {
      const formatIndex = paragraphIndex;
      paragraphIndex += 1;
      docxParagraphFormats.push(docxParagraphFormat(paragraph, docxStyles));
      const styleId = `CodexImportParagraph${formatIndex}`;
      styleMap.push(`p.${styleId} => ${docxHtmlPath(paragraph, formatIndex)}`);
      return {
        ...applyDocxParagraphRunStyle(paragraph, docxStyles),
        styleId,
      };
    }),
  };
}

function sameMarks(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function appendInlineText(segment, value, marks) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ');
  if (!normalized) return;
  const previous = segment[segment.length - 1];
  if (previous?.type === 'text' && sameMarks(previous.marks, marks)) {
    previous.text += normalized;
    return;
  }
  const node = { type: 'text', text: normalized };
  if (marks.length) node.marks = marks.map((type) => ({ type }));
  segment.push(node);
}

function trimInlineContent(content) {
  const nodes = content
    .filter((node) => node.type === 'hardBreak' || (node.type === 'text' && node.text))
    .map((node) => ({ ...node, marks: node.marks ? [...node.marks] : undefined }));
  if (!nodes.length) return [];
  while (nodes[0]?.type === 'hardBreak') nodes.shift();
  while (nodes.at(-1)?.type === 'hardBreak') nodes.pop();
  const firstText = nodes.find((node) => node.type === 'text');
  const lastText = nodes.findLast((node) => node.type === 'text');
  if (firstText) firstText.text = firstText.text.replace(/^\s+/, '');
  if (lastText) lastText.text = lastText.text.replace(/\s+$/, '');
  return nodes.filter((node) => node.type === 'hardBreak' || node.text);
}

function contentText(content) {
  return content.map((node) => node.type === 'hardBreak' ? '\n' : node.text ?? '').join('');
}

function splitLeadingEmphasizedTitle(content) {
  let splitIndex = 0;
  let sawBoldText = false;
  while (splitIndex < content.length) {
    const node = content[splitIndex];
    if (
      node.type !== 'text'
      || !node.marks?.some((mark) => mark.type === 'bold')
    ) {
      break;
    }
    sawBoldText ||= Boolean(node.text?.trim());
    splitIndex += 1;
  }
  if (!sawBoldText || splitIndex === content.length) return null;

  const titleContent = trimInlineContent(content.slice(0, splitIndex));
  const bodyContent = trimInlineContent(content.slice(splitIndex));
  const title = contentText(titleContent);
  const body = contentText(bodyContent);
  const titleWords = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const likelyStandaloneTitle = (
    /^(?:assignment|article|chapter|section|part|appendix|abstract|introduction|conclusion|references)\b/iu.test(title)
    || /[:)]$/u.test(title)
  );
  if (
    !body
    || titleWords.length > 16
    || Array.from(title).length > 160
    || /[.!?]$/u.test(title)
    || !likelyStandaloneTitle
    || !/^[\p{Lu}\p{N}]/u.test(body)
  ) {
    return null;
  }
  return { titleContent, title, bodyContent, body };
}

function inlineSegments(root) {
  const content = [];

  function walk(node, activeMarks = []) {
    if (node.nodeName === '#text') {
      appendInlineText(content, node.value, activeMarks);
      return;
    }
    const tagName = node.tagName?.toLowerCase();
    if (tagName === 'br') {
      if (content.length && content.at(-1)?.type !== 'hardBreak') {
        content.push({ type: 'hardBreak' });
      }
      return;
    }
    const mark = MARK_TAGS.get(tagName);
    const nextMarks = mark ? [...activeMarks, mark] : activeMarks;
    for (const child of node.childNodes ?? []) {
      walk(child, nextMarks);
    }
  }

  walk(root);
  const normalized = trimInlineContent(content);
  return normalized.length ? [normalized] : [];
}

function normalizeNumberedHeading(block) {
  if (Array.from(String(block.text ?? '')).length > 160) return block;
  const content = (block.content ?? []).map((node) => ({ ...node }));
  const firstText = content.find((node) => node.type === 'text');
  if (!firstText) return block;
  firstText.text = firstText.text.replace(
    /^(\s*\d+(?:\.\d+)+)(?=\p{Lu})/u,
    '$1 ',
  );
  return {
    ...block,
    text: contentText(content),
    content,
  };
}

function markBibliographyStructure(blocks) {
  let insideBibliography = false;
  return blocks.map((block) => {
    const text = String(block.text ?? '').trim();
    if (/^(?:references|bibliography|works cited)\s*$/iu.test(text)) {
      insideBibliography = true;
      return {
        ...block,
        sourceType: 'bibliographyHeading',
        attrs: {
          ...(block.attrs ?? {}),
          sourceType: 'bibliographyHeading',
          textIndent: '0in',
          formatOverrides: [
            ...new Set([...(block.attrs?.formatOverrides ?? []), 'textIndent']),
          ],
        },
      };
    }
    if (!insideBibliography) return block;
    return {
      ...block,
      sourceType: 'bibliographyEntry',
      attrs: {
        ...(block.attrs ?? {}),
        sourceType: 'bibliographyEntry',
        textIndent: '0in',
        formatOverrides: [
          ...new Set([...(block.attrs?.formatOverrides ?? []), 'textIndent']),
        ],
      },
    };
  });
}

export function blocksFromHtml(
  html,
  { integrityMode = 'strict', docxParagraphFormats = [] } = {},
) {
  const fragment = parseFragment(String(html ?? ''));
  const blocks = [];

  function walk(node) {
    const tagName = node.tagName?.toLowerCase();
    if (BLOCK_TAGS.has(tagName)) {
      const segments = inlineSegments(node);
      if (!segments.length && tagName === 'p') {
        if (blocks.at(-1)?.sourceType !== 'boundary') {
          blocks.push({
            sourceType: 'boundary',
            text: '',
            attrs: { sourceType: 'boundary' },
            content: [],
          });
        }
        return;
      }
      for (const content of segments) {
        const emphasizedPrefix = tagName === 'p'
          ? splitLeadingEmphasizedTitle(content)
          : null;
        if (emphasizedPrefix) {
          blocks.push(normalizeNumberedHeading(textBlock(
            emphasizedPrefix.title,
            'heading',
            mergeFormatAttrs(
              attrsForHtmlBlock(tagName, node, docxParagraphFormats),
              { level: 2 },
            ),
            emphasizedPrefix.titleContent,
          )));
          blocks.push(textBlock(
            emphasizedPrefix.body,
            'paragraph',
            attrsForHtmlBlock(tagName, node, docxParagraphFormats),
            emphasizedPrefix.bodyContent,
          ));
          continue;
        }
        const text = contentText(content);
        blocks.push(normalizeNumberedHeading(textBlock(
          text,
          sourceTypeForTag(tagName),
          attrsForHtmlBlock(tagName, node, docxParagraphFormats),
          content,
        )));
      }
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  }

  walk(fragment);
  return ensureBlocks(markBibliographyStructure(
    cleanExtractedBlocks(blocks, { integrityMode }),
  ));
}

export async function extractDocxBlocks(buffer) {
  try {
    const docxStyles = await readDocxParagraphStyles(buffer);
    const docxParagraphFormats = [];
    const htmlResult = await mammoth.convertToHtml(
      { buffer },
      docxConversionOptions(docxParagraphFormats, docxStyles),
    );
    if (htmlResult.value.trim()) {
      return blocksFromHtml(htmlResult.value, { docxParagraphFormats });
    }
    const textResult = await mammoth.extractRawText({ buffer });
    return extractTextBlocks(textResult.value);
  } catch (error) {
    if (error.statusCode) throw error;
    throw resolverError('The .docx file could not be parsed.');
  }
}

// This is the single upload-to-block boundary. Future semantic clustering can
// replace the extension branches below while preserving this block contract.
export async function resolveDocumentUpload({ buffer, filename }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw resolverError('The uploaded file is empty.');
  }
  const extension = path.extname(String(filename ?? '')).toLowerCase();
  if (extension === '.doc') {
    throw resolverError('.doc uploads are not supported. Please upload .docx, .md, or .txt.');
  }
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw resolverError('Only .txt, .md, and .docx uploads are supported.');
  }
  if (extension === '.docx') return extractDocxBlocks(buffer);
  const text = decodeUtf8(buffer);
  return extension === '.md' ? extractMarkdownBlocks(text) : extractTextBlocks(text);
}

// Compatibility output for a future clustering pipeline that only needs text.
export function initialClustering(text) {
  return extractTextBlocks(text).map((block) => block.text);
}
