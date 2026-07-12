import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
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
import {
  findCachedBlockAnalysis,
  formatBlockAnalysis,
  getOwnedBlockContext,
  saveBlockAnalysis,
} from '../models/analyses.js';
import {
  ANALYSIS_FILTERS,
  BLOCK_ANALYSIS_PROMPT_VERSION,
  analysisFilterSignature,
  computeDeterministicMetrics,
  generateBlockAnalysis,
  hashBlockText,
  normalizeAnalysisFilters,
} from '../ai/blockAnalysis.js';
import {
  BLOCK_REWRITE_PROMPT_VERSION,
  generateBlockRewrites,
  normalizeRewriteTone,
} from '../ai/blockRewrites.js';
import {
  findCachedBlockRewrites,
  formatBlockRewrite,
  markRewriteAccepted,
  saveBlockRewrite,
} from '../models/rewrites.js';

const require = createRequire(import.meta.url);
const {
  characterBalancedRanges,
  clusteringWithMetadata,
} = require('../../scripts/lib/clustering.cjs');

const router = Router();
const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

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
  let paragraphIndex = 0;

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
        attrs: { ...currentAttrs, paragraphIndex },
      });
    }
    if (text) paragraphIndex += 1;
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
    return clusteringWithMetadata(textResult.value, {
      paragraphBreak: 'blank-line',
      partitionMode,
    }).map((block) => ({
      text: block.text,
      attrs: { paragraphIndex: block.paragraphIndex },
    }));
  }

  if (lowerName.endsWith('.md')) {
    return clusteringWithMetadata(file.buffer.toString('utf8'), {
      paragraphBreak: 'blank-line',
      partitionMode,
    }).map((block) => ({
      text: block.text,
      attrs: { paragraphIndex: block.paragraphIndex },
    }));
  }

  if (lowerName.endsWith('.txt')) {
    return clusteringWithMetadata(file.buffer.toString('utf8'), { partitionMode }).map((block) => ({
      text: block.text,
      attrs: { paragraphIndex: block.paragraphIndex },
    }));
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

router.post('/:id/blocks/:blockId/analyze', aiRateLimiter, async (req, res) => {
  const requestedFilters = req.body?.filters;
  if (
    !Array.isArray(requestedFilters)
    || requestedFilters.some((filter) => !ANALYSIS_FILTERS.includes(filter))
  ) {
    res.status(400).json({ error: 'Analysis filters are invalid.' });
    return;
  }

  const filters = normalizeAnalysisFilters(requestedFilters);
  if (!filters.length) {
    res.status(400).json({ error: 'Select at least one analysis filter.' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const context = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!context) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }

  const sourceTextHash = hashBlockText(context.text_content);
  const filterSignature = analysisFilterSignature(filters);
  const model = process.env.OPENAI_ANALYSIS_MODEL || 'gpt-5.4-mini';
  const cached = await findCachedBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    filterSignature,
    model,
    promptVersion: BLOCK_ANALYSIS_PROMPT_VERSION,
  });
  if (cached) {
    res.json({ analysis: formatBlockAnalysis(cached), cached: true });
    return;
  }

  const deterministicMetrics = computeDeterministicMetrics(context.text_content);
  const generated = await generateBlockAnalysis({ context, filters });
  const saved = await saveBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    filterSignature,
    filters,
    deterministicMetrics,
    result: generated.result,
    usage: generated.usage,
    model: generated.model,
    promptVersion: BLOCK_ANALYSIS_PROMPT_VERSION,
  });

  res.status(201).json({ analysis: formatBlockAnalysis(saved), cached: false });
});

router.post('/:id/blocks/:blockId/rewrites', aiRateLimiter, async (req, res) => {
  const tone = normalizeRewriteTone(req.body?.tone);
  const force = req.body?.force ?? false;

  if (!tone || typeof force !== 'boolean') {
    res.status(400).json({ error: 'Rewrite request is invalid.' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const context = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!context) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }

  const tones = [tone];
  const sourceTextHash = hashBlockText(context.text_content);
  const model = process.env.OPENAI_REWRITE_MODEL || 'gpt-5.4-mini';

  if (!force) {
    const cached = await findCachedBlockRewrites({
      documentId: context.document_id,
      blockId: context.id,
      sourceTextHash,
      tones,
      model,
      promptVersion: BLOCK_REWRITE_PROMPT_VERSION,
    });
    if (cached.length === tones.length) {
      const order = new Map(tones.map((item, index) => [item, index]));
      cached.sort((a, b) => order.get(a.tone) - order.get(b.tone));
      res.json({ rewrites: cached.map(formatBlockRewrite), cached: true });
      return;
    }
  }

  const generated = await generateBlockRewrites({ context, tone });
  const saved = await Promise.all(generated.options.map((option) => saveBlockRewrite({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    option,
    usage: generated.usage,
    model: generated.model,
    promptVersion: BLOCK_REWRITE_PROMPT_VERSION,
  })));

  res.status(201).json({ rewrites: saved.map(formatBlockRewrite), cached: false });
});

router.post('/:id/blocks/:blockId/rewrites/:rewriteId/accept', async (req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const accepted = await markRewriteAccepted({
    documentId: req.params.id,
    blockId: req.params.blockId,
    rewriteId: req.params.rewriteId,
    userId: user.id,
  });
  if (!accepted) {
    res.status(404).json({ error: 'Rewrite option not found' });
    return;
  }

  res.json({ rewrite: formatBlockRewrite(accepted) });
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
