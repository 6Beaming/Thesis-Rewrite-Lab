import path from 'node:path';
import mammoth from 'mammoth';
import { parseFragment } from 'parse5';

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
  return {
    sourceType,
    text,
    attrs: { sourceType, ...attrs },
    content: content ?? (text ? [{ type: 'text', text }] : []),
  };
}

function ensureBlocks(blocks) {
  const normalized = blocks.filter((block) => block.text.trim());
  if (!normalized.length) {
    throw resolverError('The uploaded document does not contain any text blocks.');
  }
  return normalized;
}

export function extractTextBlocks(text) {
  const blocks = normalizeText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => textBlock(line));
  return ensureBlocks(blocks);
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
    .filter((node) => node.type === 'text' && node.text)
    .map((node) => ({ ...node, marks: node.marks ? [...node.marks] : undefined }));
  if (!nodes.length) return [];
  nodes[0].text = nodes[0].text.replace(/^\s+/, '');
  nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s+$/, '');
  return nodes.filter((node) => node.text);
}

function contentText(content) {
  return content.map((node) => node.text ?? '').join('');
}

function inlineSegments(root) {
  const segments = [[]];

  function walk(node, activeMarks = []) {
    if (node.nodeName === '#text') {
      appendInlineText(segments[segments.length - 1], node.value, activeMarks);
      return;
    }
    const tagName = node.tagName?.toLowerCase();
    if (tagName === 'br') {
      segments.push([]);
      return;
    }
    const mark = MARK_TAGS.get(tagName);
    const nextMarks = mark ? [...activeMarks, mark] : activeMarks;
    for (const child of node.childNodes ?? []) {
      walk(child, nextMarks);
    }
  }

  walk(root);
  return segments.map(trimInlineContent).filter((content) => contentText(content).trim());
}

export function blocksFromHtml(html) {
  const fragment = parseFragment(String(html ?? ''));
  const blocks = [];

  function walk(node) {
    const tagName = node.tagName?.toLowerCase();
    if (BLOCK_TAGS.has(tagName)) {
      const segments = inlineSegments(node);
      for (const content of segments) {
        const text = contentText(content);
        blocks.push(textBlock(
          text,
          sourceTypeForTag(tagName),
          attrsForTag(tagName),
          content,
        ));
      }
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  }

  walk(fragment);
  return ensureBlocks(blocks);
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
