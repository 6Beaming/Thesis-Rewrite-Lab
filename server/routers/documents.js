import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRequire } from 'module';
import path from 'path';
import { upload } from '../middlewares/upload.js';
import { resolveDocumentUpload } from '../../src/services/documentResolver.js';
import { getOrCreateUserFromSession, getUserStats } from '../models/users.js';
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
  findLatestBlockAnalysis,
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
import {
  PRACTICE_FEEDBACK_PROMPT_VERSION,
  generatePracticeFeedback,
  normalizePracticeAttempt,
} from '../ai/practiceFeedback.js';
import {
  findCachedPracticeFeedback,
  formatPracticeFeedback,
  savePracticeFeedback,
} from '../models/practice.js';
import { lookupAcademicSourcesViaMcp } from '../mcp/academicSources.js';

const require = createRequire(import.meta.url);
const { characterBalancedRanges } = require('../../scripts/lib/clustering.cjs');

const router = Router();
const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACADEMIC_STYLES = new Set(['APA', 'MLA', 'Chicago', 'Customized']);
const BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);
const UUID_PATTERN_LOWERCASE = UUID_PATTERN;

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function mutationIdFromRequest(req) {
  const value = String(req.get('x-mutation-id') ?? '');
  return UUID_PATTERN_LOWERCASE.test(value) ? value : null;
}

async function publishProgress(req, user, document, mutationId) {
  const publisher = req.app.get('eventPublisher');
  if (!publisher) return;
  publisher.publishProgress({
    authUserId: resAuthUserId(req),
    productUserId: user.id,
    stats: await getUserStats(user.id),
    documentId: document?.id ?? null,
    revision: document?.revision ?? null,
    mutationId,
  });
}

function resAuthUserId(req) {
  return req.res?.locals?.session?.user?.id ?? req.app?.locals?.session?.user?.id ?? null;
}

function publishDocument(req, user, type, document, mutationId, extra = {}) {
  const publisher = req.app.get('eventPublisher');
  if (!publisher) return;
  publisher.publishDocument({
    authUserId: resAuthUserId(req),
    type,
    document,
    mutationId,
    extra,
  });
}

function publishVersion(req, user, document, version, mutationId) {
  const publisher = req.app.get('eventPublisher');
  if (!publisher || !version) return;
  publisher.publishVersion({
    authUserId: resAuthUserId(req),
    document,
    version,
    mutationId,
  });
}

function publishDeletedDocument(req, document, mutationId) {
  const publisher = req.app.get('eventPublisher');
  if (!publisher) return;
  publisher.publishDeletedDocument({
    authUserId: resAuthUserId(req),
    document,
    mutationId,
  });
}

function requireUuid(value, label) {
  if (!UUID_PATTERN.test(String(value ?? ''))) {
    throw invalidInput(`${label} must be a valid UUID`);
  }
}

function validateAcademicStyle(value) {
  if (!ACADEMIC_STYLES.has(value)) {
    throw invalidInput('Invalid academic style');
  }
}

function validateSavePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidInput('Request body must be an object');
  }
  if (payload.title !== undefined && (
    typeof payload.title !== 'string'
    || !payload.title.trim()
    || payload.title.length > 300
  )) {
    throw invalidInput('Title must contain 1 to 300 characters');
  }
  if (payload.academicStyle !== undefined) {
    validateAcademicStyle(payload.academicStyle);
  }
  if (payload.styleSettings !== undefined && (
    !payload.styleSettings
    || typeof payload.styleSettings !== 'object'
    || Array.isArray(payload.styleSettings)
  )) {
    throw invalidInput('Style settings must be an object');
  }
  if (payload.contentJson !== undefined && (
    !payload.contentJson
    || payload.contentJson.type !== 'doc'
    || !Array.isArray(payload.contentJson.content)
  )) {
    throw invalidInput('Content must be a Tiptap document');
  }
  if (payload.createVersion !== undefined && typeof payload.createVersion !== 'boolean') {
    throw invalidInput('createVersion must be a boolean');
  }
  if (payload.versionLabel !== undefined && (
    typeof payload.versionLabel !== 'string'
    || payload.versionLabel.length > 200
  )) {
    throw invalidInput('Version label must be at most 200 characters');
  }
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ') || 'Untitled document';
}

function sliceFormattedContent(content = [], start, end) {
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

  return result.filter((node) => node.text);
}

function partitionResolvedBlocks(blocks, partitionMode) {
  return blocks.flatMap((block, paragraphIndex) => {
    const ranges = characterBalancedRanges(block.text, {
      paragraphBreak: 'blank-line',
      partitionMode,
    });

    return ranges.map((range) => ({
      ...block,
      text: range.text,
      attrs: {
        ...(block.attrs ?? {}),
        paragraphIndex,
      },
      content: sliceFormattedContent(block.content, range.start, range.end),
    }));
  });
}

async function extractBlocks(file, partitionMode) {
  const structuralBlocks = await resolveDocumentUpload({
    buffer: file.buffer,
    filename: file.originalname,
  });
  return partitionResolvedBlocks(structuralBlocks, partitionMode);
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
  const mutation = await createBlankDocument(user.id, { returnMutation: true });
  const mutationId = mutationIdFromRequest(_req);
  publishDocument(_req, user, 'document:created', mutation.document, mutationId);
  publishVersion(_req, user, mutation.document, mutation.version, mutationId);
  await publishProgress(_req, user, mutation.document, mutationId);
  res.status(201).json({ document: mutation.document });
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
  const academicStyle = req.body.academicStyle ?? 'APA';
  validateAcademicStyle(academicStyle);
  const mutation = await createDocumentWithBlocks({
    userId: user.id,
    title: titleFromFilename(req.file.originalname),
    academicStyle,
    textBlocks: blocks,
    originalFile: req.file.buffer,
    originalFilename: req.file.originalname,
    originalMime: req.file.mimetype,
    returnMutation: true,
  });

  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:created', mutation.document, mutationId);
  publishVersion(req, user, mutation.document, mutation.version, mutationId);
  await publishProgress(req, user, mutation.document, mutationId);
  res.status(201).json({ document: mutation.document });
});

router.post('/trash/check-expired', async (_req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const deleted = await checkExpiredTrash(user.id);
  const mutationId = mutationIdFromRequest(_req);
  deleted.forEach((document) => publishDeletedDocument(_req, document, mutationId));
  if (deleted.length) await publishProgress(_req, user, null, mutationId);
  res.json({ deleted });
});

router.get('/:id', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

router.get('/:id/rate', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const rate = await getDocumentRate(req.params.id, user.id);
  if (!rate) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json(rate);
});

router.patch('/:id', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  validateSavePayload(req.body);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const mutation = await saveDocument(req.params.id, user.id, req.body, { returnMutation: true });
  if (!mutation) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:updated', mutation.document, mutationId);
  publishVersion(req, user, mutation.document, mutation.version, mutationId);
  await publishProgress(req, user, mutation.document, mutationId);
  res.json({ document: mutation.document });
});

router.delete('/:id', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await moveDocumentToTrash(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:trashed', document, mutationId);
  await publishProgress(req, user, document, mutationId);
  res.json({ document });
});

router.patch('/:id/blocks/:blockId', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const status = req.body.status;
  if (!BLOCK_STATUSES.has(status)) {
    res.status(400).json({ error: 'Invalid block status' });
    return;
  }

  const result = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status,
  });
  if (result === null) {
    res.status(404).json({ error: 'Document or block not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  const block = result.document.blocks.find((item) => item.id === req.params.blockId) ?? null;
  publishDocument(req, user, 'block:updated', result.document, mutationId, {
    block,
    nextProcessingBlock: result.nextProcessingBlock,
  });
  publishVersion(req, user, result.document, result.version, mutationId);
  await publishProgress(req, user, result.document, mutationId);
  res.json(result);
});

router.post('/:id/blocks/:blockId/analyze', aiRateLimiter, async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
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
  const sourceLookup = await lookupAcademicSourcesViaMcp(context.text_content);
  const generated = await generateBlockAnalysis({ context, filters, sourceLookup });
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
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
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
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  requireUuid(req.params.rewriteId, 'Rewrite ID');
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

router.post('/:id/blocks/:blockId/practice-feedback', aiRateLimiter, async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const attemptText = normalizePracticeAttempt(req.body?.attemptText);
  if (!attemptText) {
    res.status(400).json({ error: 'Practice text is empty or too long.' });
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
  const attemptTextHash = hashBlockText(attemptText);
  const latestAnalysis = await findLatestBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
  });
  const analysisContextKey = latestAnalysis?.id ?? 'none';
  const model = process.env.OPENAI_PRACTICE_MODEL || 'gpt-5.4-mini';
  const cached = await findCachedPracticeFeedback({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    attemptTextHash,
    analysisContextKey,
    model,
    promptVersion: PRACTICE_FEEDBACK_PROMPT_VERSION,
  });
  if (cached) {
    res.json({ practice: formatPracticeFeedback(cached), cached: true });
    return;
  }

  const generated = await generatePracticeFeedback({
    context,
    attemptText,
    analysis: latestAnalysis ? formatBlockAnalysis(latestAnalysis) : null,
  });
  const saved = await savePracticeFeedback({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    attemptText,
    attemptTextHash,
    analysisContextKey,
    result: generated.result,
    usage: generated.usage,
    model: generated.model,
    promptVersion: PRACTICE_FEEDBACK_PROMPT_VERSION,
  });

  res.status(201).json({ practice: formatPracticeFeedback(saved), cached: false });
});

router.post('/:id/blocks/:blockId/skip', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const result = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status: 'skipped',
  });
  if (result === null) {
    res.status(404).json({ error: 'Document or block not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  const block = result.document.blocks.find((item) => item.id === req.params.blockId) ?? null;
  publishDocument(req, user, 'block:updated', result.document, mutationId, {
    block,
    nextProcessingBlock: result.nextProcessingBlock,
  });
  publishVersion(req, user, result.document, result.version, mutationId);
  await publishProgress(req, user, result.document, mutationId);
  res.json(result);
});

router.post('/:id/blocks/:blockId/complete', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const result = await updateDocumentBlockStatus({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    status: 'processed',
  });
  if (result === null) {
    res.status(404).json({ error: 'Document or block not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  const block = result.document.blocks.find((item) => item.id === req.params.blockId) ?? null;
  publishDocument(req, user, 'block:updated', result.document, mutationId, {
    block,
    nextProcessingBlock: result.nextProcessingBlock,
  });
  publishVersion(req, user, result.document, result.version, mutationId);
  await publishProgress(req, user, result.document, mutationId);
  res.json(result);
});

router.get('/:id/versions', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  res.json({ versions: await listVersions(req.params.id, user.id) });
});

router.get('/:id/versions/:versionId', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.versionId, 'Version ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const version = await getVersion(req.params.id, req.params.versionId, user.id);
  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  res.json({ version });
});

router.post('/:id/revert', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.body.versionId, 'Version ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const result = await revertDocumentToVersion(req.params.id, req.body.versionId, user.id);
  if (!result) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:reverted', result.document, mutationId);
  publishVersion(req, user, result.document, result.version, mutationId);
  await publishProgress(req, user, result.document, mutationId);
  res.json(result);
});

export default router;
