import path from 'node:path';
import mammoth from 'mammoth';
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

export function blocksFromHtml(html, { integrityMode = 'strict' } = {}) {
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
            { level: 2 },
            emphasizedPrefix.titleContent,
          )));
          blocks.push(textBlock(
            emphasizedPrefix.body,
            'paragraph',
            {},
            emphasizedPrefix.bodyContent,
          ));
          continue;
        }
        const text = contentText(content);
        blocks.push(normalizeNumberedHeading(textBlock(
          text,
          sourceTypeForTag(tagName),
          attrsForTag(tagName),
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
    const htmlResult = await mammoth.convertToHtml({ buffer });
    if (htmlResult.value.trim()) return blocksFromHtml(htmlResult.value);
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
