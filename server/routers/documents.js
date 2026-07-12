import { Router } from 'express';
import path from 'path';
import { createRequire } from 'module';
import mammoth from 'mammoth';
import { upload } from '../middlewares/upload.js';
import { getOrCreateUserFromSession } from '../models/users.js';
import {
  checkExpiredTrash,
  createBlankDocument,
  createDocumentWithBlocks,
  getDocument,
  getDocumentRate,
  listDocuments,
  moveDocumentToTrash,
  saveDocument,
  updateDocumentBlockStatus,
} from '../models/documents.js';
import { getVersion, listVersions, revertDocumentToVersion } from '../models/versions.js';

const require = createRequire(import.meta.url);
const {
  characterBalancedRanges,
  clustering,
} = require('../../scripts/lib/clustering.cjs');

const router = Router();

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ') || 'Untitled document';
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function markForTag(tagName) {
  if (tagName === 'strong' || tagName === 'b') return 'bold';
  if (tagName === 'em' || tagName === 'i') return 'italic';
  if (tagName === 'u') return 'underline';
  if (tagName === 'code') return 'code';
  return null;
}

function attrsForBlockTag(tagName) {
  if (tagName === 'h1') return { fontSize: '20pt', textIndent: '0in' };
  if (tagName === 'h2') return { fontSize: '16pt', textIndent: '0in' };
  if (tagName === 'h3') return { fontSize: '14pt', textIndent: '0in' };
  if (tagName === 'li') return { textIndent: '0.25in' };
  return {};
}

function cloneMarks(activeMarks) {
  return activeMarks.map((type) => ({ type }));
}

function appendText(content, text, activeMarks) {
  if (!text) return;
  const node = { type: 'text', text };
  if (activeMarks.length) node.marks = cloneMarks(activeMarks);
  content.push(node);
}

function trimContent(content) {
  const next = content
    .map((node) => ({ ...node, marks: node.marks ? [...node.marks] : undefined }))
    .filter((node) => node.text);

  while (next.length && !next[0].text.trim()) {
    next.shift();
  }
  while (next.length && !next[next.length - 1].text.trim()) {
    next.pop();
  }
  if (next.length) {
    next[0].text = next[0].text.replace(/^\s+/, '');
    next[next.length - 1].text = next[next.length - 1].text.replace(/\s+$/, '');
  }
  return next.filter((node) => node.text);
}

function textFromContent(content) {
  return content.map((node) => node.text ?? '').join('');
}

function sliceFormattedContent(content, start, end) {
  const result = [];
  let offset = 0;

  for (const node of content) {
    const text = node.text ?? '';
    const nodeEnd = offset + text.length;
    const sliceStart = Math.max(start, offset);
    const sliceEnd = Math.min(end, nodeEnd);

    if (sliceStart < sliceEnd) {
      result.push({
        ...node,
        text: text.slice(sliceStart - offset, sliceEnd - offset),
      });
    }
    offset = nodeEnd;
  }

  return trimContent(result);
}

function formattedBlocksFromHtml(html, partitionMode) {
  const blocks = [];
  let activeMarks = [];
  let currentContent = [];
  let currentAttrs = {};

  function finishBlock({ resetAttrs = false } = {}) {
    const content = trimContent(currentContent);
    const text = textFromContent(content);
    for (const range of characterBalancedRanges(text, {
      paragraphBreak: 'blank-line',
      partitionMode,
    })) {
      blocks.push({
        text: range.text,
        content: sliceFormattedContent(content, range.start, range.end),
        attrs: { ...currentAttrs },
      });
    }
    currentContent = [];
    if (resetAttrs) currentAttrs = {};
  }

  function appendFormattedText(rawText) {
    const decoded = decodeHtmlEntities(rawText).replace(/\s+/g, ' ');
    appendText(currentContent, decoded, activeMarks);
  }

  const tokenPattern = /<[^>]+>|[^<]+/g;
  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0];
    if (!token.startsWith('<')) {
      appendFormattedText(token);
      continue;
    }

    const tag = token.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);
    if (!tag) continue;

    const isClosing = Boolean(tag[1]);
    const tagName = tag[2].toLowerCase();
    const mark = markForTag(tagName);
    const isBlockTag = ['p', 'div', 'li', 'h1', 'h2', 'h3'].includes(tagName);

    if (tagName === 'br' && !isClosing) {
      appendText(currentContent, '\n', activeMarks);
      continue;
    }

    if (mark) {
      if (isClosing) {
        const index = activeMarks.lastIndexOf(mark);
        if (index >= 0) activeMarks.splice(index, 1);
      } else {
        activeMarks.push(mark);
      }
      continue;
    }

    if (isBlockTag) {
      if (!isClosing) {
        finishBlock({ resetAttrs: true });
        currentAttrs = attrsForBlockTag(tagName);
      } else {
        finishBlock({ resetAttrs: true });
      }
    }
  }

  finishBlock({ resetAttrs: true });
  return blocks;
}

async function extractBlocks(file, partitionMode) {
  const lowerName = file.originalname.toLowerCase();

  if (lowerName.endsWith('.doc')) {
    const error = new Error('.doc uploads are not supported. Please upload .docx, .md, or .txt.');
    error.statusCode = 400;
    throw error;
  }

  if (lowerName.endsWith('.docx')) {
    const htmlResult = await mammoth.convertToHtml({ buffer: file.buffer });
    const formattedBlocks = formattedBlocksFromHtml(htmlResult.value, partitionMode);
    if (formattedBlocks.length) return formattedBlocks;

    const textResult = await mammoth.extractRawText({ buffer: file.buffer });
    return clustering(textResult.value, { paragraphBreak: 'blank-line', partitionMode });
  }

  if (lowerName.endsWith('.md')) {
    return clustering(file.buffer.toString('utf8'), { paragraphBreak: 'blank-line', partitionMode });
  }

  if (lowerName.endsWith('.txt')) {
    return clustering(file.buffer.toString('utf8'), { partitionMode });
  }

  const error = new Error('Only .txt, .md, and .docx uploads are supported.');
  error.statusCode = 400;
  throw error;
}

router.get('/', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const documents = await listDocuments({
    userId: user.id,
    q: String(req.query.q ?? ''),
    sort: String(req.query.sort ?? 'most_recent'),
    trashed: false,
  });
  res.json({ documents });
});

router.post('/', async (_req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await createBlankDocument(user.id);
  res.status(201).json({ document });
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'File is required' });
    return;
  }

  const partitionMode = req.body.partitionMode ?? process.env.DOCUMENT_PARTITION_MODE ?? 'semantic';
  if (!['character', 'semantic'].includes(partitionMode)) {
    res.status(400).json({ error: 'Partition mode must be character or semantic' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const blocks = await extractBlocks(req.file, partitionMode);
  const document = await createDocumentWithBlocks({
    userId: user.id,
    title: titleFromFilename(req.file.originalname),
    academicStyle: req.body.academicStyle ?? 'APA',
    textBlocks: blocks,
    originalFile: req.file.buffer,
    originalFilename: req.file.originalname,
    originalMime: req.file.mimetype,
  });

  res.status(201).json({ document });
});

router.post('/trash/check-expired', async (_req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const deleted = await checkExpiredTrash(user.id);
  res.json({ deleted });
});

router.get('/:id', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

router.get('/:id/rate', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const rate = await getDocumentRate(req.params.id, user.id);
  if (!rate) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json(rate);
});

router.patch('/:id', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await saveDocument(req.params.id, user.id, req.body);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

router.delete('/:id', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await moveDocumentToTrash(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

router.patch('/:id/blocks/:blockId', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const status = req.body.status;
  if (!['unprocessed', 'processing', 'processed', 'skipped'].includes(status)) {
    res.status(400).json({ error: 'Invalid block status' });
    return;
  }

  const next = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status,
  });
  if (next === null) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ nextProcessingBlock: next });
});

router.post('/:id/blocks/:blockId/skip', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const next = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status: 'skipped',
  });
  if (next === null) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ nextProcessingBlock: next });
});

router.post('/:id/blocks/:blockId/complete', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const next = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status: 'processed',
  });
  if (next === null) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ nextProcessingBlock: next });
});

router.get('/:id/versions', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  res.json({ versions: await listVersions(req.params.id, user.id) });
});

router.get('/:id/versions/:versionId', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const version = await getVersion(req.params.id, req.params.versionId, user.id);
  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  res.json({ version });
});

router.post('/:id/revert', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const version = await revertDocumentToVersion(req.params.id, req.body.versionId, user.id);
  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const document = await getDocument(req.params.id, user.id);
  res.json({ version, document });
});

export default router;
