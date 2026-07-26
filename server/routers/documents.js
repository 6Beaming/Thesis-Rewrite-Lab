import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { upload } from '../middlewares/upload.js';
import { resolveDocumentUpload } from '../../src/services/documentResolver.js';
import { segmentText } from '../../src/lib/blockSegmentation/index.js';
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
  createRewritePreferenceContext,
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
import {
  correlationIdFromRequest,
  logAiStage,
  mapAiError,
  publicAiError,
} from '../ai/errors.js';
import {
  enqueueRewriteWindow,
  getRewriteIdentityState,
} from '../models/rewriteJobs.js';
import {
  contentDispositionForTitle,
  createDocumentExport,
  DOCX_MIME,
} from '../export/documentExport.js';

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

function rewritePreferenceContextForUser(user, request = {}) {
  return createRewritePreferenceContext({
    savedPreferences: user.writing_preferences,
    savedPreferencesEnabled: user.use_writing_preferences !== false,
    useSavedPreferences: request.useSavedPreferences ?? true,
    preferenceOverrides: request.preferenceOverrides,
  });
}

function aiRoute(handler) {
  return async (req, res) => {
    const correlationId = correlationIdFromRequest(req);
    res.set('X-Correlation-Id', correlationId);
    let currentStage = 'context-lookup';
    const details = {
      correlationId,
      documentId: req.params.id,
      blockId: req.params.blockId,
    };
    const ai = {
      correlationId,
      stage(stage, extra = {}) {
        currentStage = stage;
        logAiStage({ ...details, ...extra, stage });
      },
    };
    try {
      await handler(req, res, ai);
    } catch (cause) {
      logAiStage({
        ...details,
        stage: currentStage,
        outcome: 'failed',
        error: cause,
      });
      throw mapAiError(cause, { stage: currentStage, correlationId });
    }
  };
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

export function sliceFormattedContent(content = [], start, end) {
  const result = [];
  let offset = 0;

  for (const node of content) {
    const isHardBreak = node.type === 'hardBreak';
    const text = isHardBreak ? '\n' : node.text ?? '';
    const nodeEnd = offset + text.length;
    const sliceStart = Math.max(start, offset);
    const sliceEnd = Math.min(end, nodeEnd);

    if (sliceStart < sliceEnd) {
      result.push(isHardBreak
        ? { ...node }
        : {
          ...node,
          text: text.slice(sliceStart - offset, sliceEnd - offset),
        });
    }
    offset = nodeEnd;
  }

  return result.filter((node) => node.type === 'hardBreak' || node.text);
}

export function partitionResolvedBlocks(blocks, partitionMode = 'character-balanced') {
  return blocks.flatMap((block, paragraphIndex) => {
    const ranges = segmentText(block.text, {
      strategy: partitionMode === 'character' ? 'character-balanced' : partitionMode,
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

  const partitionMode = req.body.partitionMode ?? process.env.DOCUMENT_PARTITION_MODE ?? 'character';
  if (partitionMode !== 'character') {
    res.status(400).json({ error: 'Partition mode must be character' });
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

router.get('/:id/export', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document || document.trashed) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const buffer = await createDocumentExport(document);
  res
    .status(200)
    .set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDispositionForTitle(document.title),
      'Content-Length': String(buffer.length),
      'Content-Type': DOCX_MIME,
    })
    .send(buffer);
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

router.post('/:id/blocks/:blockId/analyze', aiRateLimiter, aiRoute(async (req, res, ai) => {
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
  ai.stage('context-lookup');
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
  ai.stage('cache-lookup', { sourceTextHash });
  const cached = await findCachedBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    filterSignature,
    model,
    promptVersion: BLOCK_ANALYSIS_PROMPT_VERSION,
  });
  if (cached) {
    res.json({
      analysis: formatBlockAnalysis(cached),
      cached: true,
      correlationId: ai.correlationId,
    });
    return;
  }

  const deterministicMetrics = computeDeterministicMetrics(context.text_content);
  const sourceLookup = await lookupAcademicSourcesViaMcp(context.text_content);
  ai.stage('provider-request', { sourceTextHash });
  const generated = await generateBlockAnalysis({ context, filters, sourceLookup });
  ai.stage('persistence', { sourceTextHash });
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

  res.status(201).json({
    analysis: formatBlockAnalysis(saved),
    cached: false,
    correlationId: ai.correlationId,
  });
}));

router.get('/:id/blocks/:blockId/rewrites', aiRoute(async (req, res, ai) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const preferenceContext = rewritePreferenceContextForUser(user);
  ai.stage('cache-lookup', { sourceTextHash: req.query.sourceTextHash ?? null });
  const state = await getRewriteIdentityState({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    sourceTextHash: String(req.query.sourceTextHash ?? ''),
    preferenceContext,
    promptVersion: preferenceContext.promptVersion,
  });
  if (!state) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }
  res.json({
    ...state,
    effectivePreferences: preferenceContext.effectivePreferences,
    preferenceWarnings: preferenceContext.warnings,
    rewrites: state.rewrites.map(formatBlockRewrite),
    jobs: state.jobs.map((job) => ({
      id: job.id,
      blockId: job.block_id,
      sourceTextHash: job.source_text_hash,
      partitionGeneration: Number(job.partition_generation),
      requestedTones: job.requested_tones,
      model: job.model,
      promptVersion: job.prompt_version,
      status: job.status,
      attemptCount: Number(job.attempt_count),
      errorCode: job.safe_error_code,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    })),
    correlationId: ai.correlationId,
  });
}));

router.post('/:id/blocks/:blockId/rewrites/prewarm', aiRoute(async (req, res, ai) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const preferenceContext = rewritePreferenceContextForUser(user);
  ai.stage('context-lookup');
  const context = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!context) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }
  ai.stage('queue-enqueue', { sourceTextHash: hashBlockText(context.text_content) });
  const jobs = await enqueueRewriteWindow({
    documentId: req.params.id,
    userId: user.id,
    blockId: req.params.blockId,
    preferenceContext,
    promptVersion: preferenceContext.promptVersion,
  });
  res.status(202).json({ jobs, correlationId: ai.correlationId });
}));

router.post('/:id/blocks/:blockId/rewrites', aiRateLimiter, aiRoute(async (req, res, ai) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const tone = normalizeRewriteTone(req.body?.tone);
  const force = req.body?.force ?? false;

  if (!tone || typeof force !== 'boolean') {
    res.status(400).json({ error: 'Rewrite request is invalid.' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const preferenceContext = rewritePreferenceContextForUser(user, req.body);
  ai.stage('context-lookup');
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
  const identity = {
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    partitionGeneration: Number(context.partition_generation) || 0,
    tone,
    model,
    promptVersion: preferenceContext.promptVersion,
    effectivePreferences: preferenceContext.effectivePreferences,
    preferenceSchemaVersion: preferenceContext.schemaVersion,
    preferenceCompilerVersion: preferenceContext.compilerVersion,
    preferenceWarnings: preferenceContext.warnings,
  };

  if (!force) {
    ai.stage('cache-lookup', { sourceTextHash });
    const cached = await findCachedBlockRewrites({
      documentId: context.document_id,
      blockId: context.id,
      sourceTextHash,
      tones,
      model,
      promptVersion: preferenceContext.promptVersion,
    });
    if (cached.length === tones.length) {
      const order = new Map(tones.map((item, index) => [item, index]));
      cached.sort((a, b) => order.get(a.tone) - order.get(b.tone));
      res.json({
        rewrites: cached.map(formatBlockRewrite),
        cached: true,
        identity,
        effectivePreferences: preferenceContext.effectivePreferences,
        preferenceWarnings: preferenceContext.warnings,
        correlationId: ai.correlationId,
      });
      return;
    }
  }

  ai.stage('provider-request', { sourceTextHash });
  const generated = await generateBlockRewrites({ context, tone, preferenceContext });
  ai.stage('context-recheck', { sourceTextHash });
  const freshContext = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (
    !freshContext
    || hashBlockText(freshContext.text_content) !== sourceTextHash
    || Number(freshContext.partition_generation) !== identity.partitionGeneration
  ) {
    throw publicAiError('STALE_BLOCK_CONTEXT', {
      statusCode: 409,
      correlationId: ai.correlationId,
    });
  }
  ai.stage('persistence', { sourceTextHash });
  const saved = await Promise.all(generated.options.map((option) => {
    const preferenceResult = generated.preferenceResults?.[option.tone];
    return saveBlockRewrite({
      documentId: context.document_id,
      blockId: context.id,
      sourceTextHash,
      option,
      usage: generated.usage,
      model: generated.model,
      promptVersion: preferenceContext.promptVersion,
      effectivePreferences: preferenceContext.effectivePreferences,
      compiledPreferenceSupplement: preferenceResult?.supplement ?? '',
      preferenceWarnings: [
        ...(preferenceContext.warnings ?? []),
        ...(preferenceResult?.warnings ?? []),
      ],
      preferenceSchemaVersion: preferenceContext.schemaVersion,
      preferenceCompilerVersion: preferenceContext.compilerVersion,
    });
  }));

  res.status(201).json({
    rewrites: saved.map(formatBlockRewrite),
    cached: false,
    identity,
    effectivePreferences: preferenceContext.effectivePreferences,
    preferenceWarnings: preferenceContext.warnings,
    correlationId: ai.correlationId,
  });
}));

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

router.post('/:id/blocks/:blockId/practice-feedback', aiRateLimiter, aiRoute(async (req, res, ai) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const attemptText = normalizePracticeAttempt(req.body?.attemptText);
  if (!attemptText) {
    res.status(400).json({ error: 'Practice text is empty or too long.' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  ai.stage('context-lookup');
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
  if (!latestAnalysis) {
    throw publicAiError('ANALYSIS_REQUIRED', {
      statusCode: 409,
      correlationId: ai.correlationId,
    });
  }
  const analysisContextKey = latestAnalysis?.id ?? 'none';
  const model = process.env.OPENAI_PRACTICE_MODEL || 'gpt-5.4-mini';
  ai.stage('cache-lookup', { sourceTextHash });
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
    res.json({
      practice: formatPracticeFeedback(cached),
      cached: true,
      identity: {
        documentId: context.document_id,
        blockId: context.id,
        sourceTextHash,
        partitionGeneration: Number(context.partition_generation) || 0,
        attemptTextHash,
        analysisContextKey,
        model,
        promptVersion: PRACTICE_FEEDBACK_PROMPT_VERSION,
      },
      correlationId: ai.correlationId,
    });
    return;
  }

  ai.stage('provider-request', { sourceTextHash });
  const generated = await generatePracticeFeedback({
    context,
    attemptText,
    analysis: latestAnalysis ? formatBlockAnalysis(latestAnalysis) : null,
  });
  ai.stage('context-recheck', { sourceTextHash });
  const freshContext = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (
    !freshContext
    || hashBlockText(freshContext.text_content) !== sourceTextHash
    || Number(freshContext.partition_generation) !== Number(context.partition_generation)
  ) {
    throw publicAiError('STALE_BLOCK_CONTEXT', {
      statusCode: 409,
      correlationId: ai.correlationId,
    });
  }
  ai.stage('persistence', { sourceTextHash });
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

  res.status(201).json({
    practice: formatPracticeFeedback(saved),
    cached: false,
    identity: {
      documentId: context.document_id,
      blockId: context.id,
      sourceTextHash,
      partitionGeneration: Number(context.partition_generation) || 0,
      attemptTextHash,
      analysisContextKey,
      model,
      promptVersion: PRACTICE_FEEDBACK_PROMPT_VERSION,
    },
    correlationId: ai.correlationId,
  });
}));

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
