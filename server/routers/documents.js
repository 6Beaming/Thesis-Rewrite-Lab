import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { documentUpload } from '../middlewares/upload.js';
import { resolveDocumentUpload } from '../../src/services/documentResolver.js';
import { segmentText } from '../../src/lib/blockSegmentation/index.js';
import { rejectLanguageIssue } from '../../src/lib/nlp/issueRejections.js';
import { getOrCreateUserFromSession, getUserStats } from '../models/users.js';
import {
  getDocumentNlpSummary,
  getOwnedBlockForNlp,
  saveBlockNlpResult,
} from '../models/blocks.js';
import {
  checkExpiredTrash,
  createBlankDocument,
  createDocumentWithBlocks,
  discardEmptyDocument,
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
import { partitionStructuralContent } from '../nlp/client.js';
import { analyzeTemporaryBlock, getNlpHealth } from '../nlp/client.js';
import {
  environmentFlag,
  nlpFeatureFlags,
  normalizeSemanticProfile,
} from '../nlp/config.js';
import { countCodePoints, sliceCodePoints } from '../nlp/hash.js';
import { NlpError, NLP_ERROR_CODES } from '../nlp/errors.js';
import {
  isRewriteEligibleBlock,
  normalizePersistedBlockNlp,
} from '../nlp/blockAggregation.js';
import {
  compileNlpRewriteSupplement,
  nlpAwareRewritePromptVersion,
} from '../ai/nlpPromptSupplement.js';
import { createNlpSnapshotFingerprint } from '../nlp/contracts.js';
import {
  enqueueDocumentNlpJob,
  getDocumentNlpJob,
  getLatestDocumentNlpJob,
} from '../models/nlpJobs.js';
import {
  citationStyleFromAcademicStyle,
  runCitationCheck,
} from '../citations/workflowRouter.js';
import { searchLiteratureQuery } from '../mcp/tools/searchLiteratureQuery.js';
import {
  CITATION_RENDERER_VERSION,
  renderCitationStyle,
} from '../mcp/tools/renderCitationStyle.js';
import { applyCitationPatch } from '../citations/patches.js';
import { convertDocumentCitationStyle } from '../citations/styleConversion.js';
import {
  findCitationResult,
  saveCitationResult,
} from '../models/citations.js';
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
    || payload.title.length > 300
  )) {
    throw invalidInput('Title must contain no more than 300 characters');
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

export function sliceFormattedContentCodePoints(content = [], startCp, endCp) {
  const result = [];
  let offsetCp = 0;
  for (const node of content) {
    const isHardBreak = node.type === 'hardBreak';
    const text = isHardBreak ? '\n' : node.text ?? '';
    const nodeLengthCp = countCodePoints(text);
    const nodeEndCp = offsetCp + nodeLengthCp;
    const sliceStartCp = Math.max(startCp, offsetCp);
    const sliceEndCp = Math.min(endCp, nodeEndCp);
    if (sliceStartCp < sliceEndCp) {
      result.push(isHardBreak
        ? { ...node }
        : {
          ...node,
          text: sliceCodePoints(
            text,
            sliceStartCp - offsetCp,
            sliceEndCp - offsetCp,
          ),
        });
    }
    offsetCp = nodeEndCp;
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

function summarizeSkippedCandidates(candidates) {
  const skipped = candidates.filter((candidate) => candidate.initialStatus === 'skipped');
  const reasons = {};
  for (const candidate of skipped) {
    for (const code of candidate.reasonCodes ?? []) {
      reasons[code] = (reasons[code] ?? 0) + 1;
    }
  }
  return {
    skippedBlockCount: skipped.length,
    reasons,
    firstSkippedCandidateIndex: skipped.length
      ? candidates.indexOf(skipped[0])
      : null,
  };
}

function assertNlpPartitionIntegrity(structuralBlocks, candidates) {
  structuralBlocks.forEach((block, paragraphIndex) => {
    const reconstructed = candidates
      .filter((candidate) => candidate.paragraphIndex === paragraphIndex)
      .map((candidate) => candidate.text)
      .join('');
    if (reconstructed !== block.text) {
      const error = new Error('Sentence grouping could not safely preserve the uploaded text.');
      error.code = 'NLP_INVALID_OUTPUT';
      error.statusCode = 502;
      throw error;
    }
  });
}

async function extractBlocks(file, partitionMode, semanticProfile) {
  const structuralBlocks = await resolveDocumentUpload({
    buffer: file.buffer,
    filename: file.originalname,
  });
  if (!environmentFlag('NLP_UPLOAD_PARTITION_ENABLED', true)) {
    return {
      blocks: partitionResolvedBlocks(structuralBlocks, partitionMode),
      nlpResult: null,
      importSummary: {
        skippedBlockCount: 0,
        reasons: {},
        firstSkippedCandidateIndex: null,
        degraded: false,
      },
    };
  }
  const nlpResult = await partitionStructuralContent({
    structuralBlocks: structuralBlocks.map((block) => ({
      text: block.text,
      sourceType: block.attrs?.sourceType ?? 'paragraph',
      level: block.attrs?.level ?? null,
      attrs: block.attrs ?? {},
    })),
    semanticProfile,
  });
  assertNlpPartitionIntegrity(structuralBlocks, nlpResult.candidates);
  const blocks = nlpResult.candidates.map((candidate) => {
    const source = structuralBlocks[candidate.paragraphIndex];
    return {
      ...source,
      text: candidate.text,
      attrs: {
        ...(source.attrs ?? {}),
        paragraphIndex: candidate.paragraphIndex,
        sourceType: candidate.sourceType,
        level: candidate.level,
        semanticProfile: nlpResult.semanticProfile,
      },
      content: sliceFormattedContentCodePoints(
        source.content,
        candidate.startCp,
        candidate.endCp,
      ),
      initialStatus: candidate.initialStatus,
      nlp: candidate.nlpAnalysis,
    };
  });
  return {
    blocks,
    nlpResult,
    importSummary: {
      ...summarizeSkippedCandidates(nlpResult.candidates),
      degraded: nlpResult.degraded,
      warnings: nlpResult.warnings,
      correlationId: nlpResult.correlationId,
    },
  };
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

router.post('/upload', documentUpload.single('file'), async (req, res) => {
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
  const semanticProfile = normalizeSemanticProfile(req.body.semanticProfile);
  const extracted = await extractBlocks(
    req.file,
    partitionMode,
    semanticProfile,
  );
  const academicStyle = req.body.academicStyle ?? 'APA';
  validateAcademicStyle(academicStyle);
  const mutation = await createDocumentWithBlocks({
    userId: user.id,
    title: titleFromFilename(req.file.originalname),
    academicStyle,
    textBlocks: extracted.blocks,
    originalFile: req.file.buffer,
    originalFilename: req.file.originalname,
    originalMime: req.file.mimetype,
    semanticProfile,
    returnMutation: true,
  });

  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:created', mutation.document, mutationId);
  publishVersion(req, user, mutation.document, mutation.version, mutationId);
  await publishProgress(req, user, mutation.document, mutationId);
  res.status(201).json({
    document: mutation.document,
    importSummary: extracted.importSummary,
  });
});

router.get('/nlp/health', async (req, res) => {
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const health = await getNlpHealth({ correlationId });
  res.status(health.status === 'ready' ? 200 : 503).json({
    ...health,
    featureFlags: nlpFeatureFlags(),
  });
});

router.get('/nlp/features', (_req, res) => {
  res.json({ featureFlags: nlpFeatureFlags() });
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

router.post('/:id/nlp/repartition', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  if (
    !environmentFlag('NLP_REPARTITION_ENABLED', true)
    || !environmentFlag('NLP_SEMANTIC_PROFILE_ENABLED', true)
  ) {
    throw new NlpError(
      NLP_ERROR_CODES.NOT_AVAILABLE,
      'Sentence regrouping is not enabled.',
      { status: 503 },
    );
  }
  const expectedRevision = Number(req.body?.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw invalidInput('Expected document revision is required.');
  }
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const job = await enqueueDocumentNlpJob({
    documentId: req.params.id,
    userId: user.id,
    semanticProfile: normalizeSemanticProfile(req.body?.semanticProfile),
    expectedRevision,
    correlationId: correlationIdFromRequest(req),
  });
  if (!job) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  req.app.get('eventPublisher')?.publishNlpJob?.({
    authUserId: user.auth_user_id,
    documentId: req.params.id,
    job,
    revision: expectedRevision,
    partitionRevision: Number(job.requested_partition_revision),
  });
  res.status(202).json({ job });
});

router.get('/:id/nlp/jobs/:jobId', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.jobId, 'Language review job ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const job = await getDocumentNlpJob({
    documentId: req.params.id,
    jobId: req.params.jobId,
    userId: user.id,
  });
  if (!job) {
    res.status(404).json({ error: 'Language review job not found' });
    return;
  }
  res.json({ job });
});

router.get('/:id/nlp/status', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const status = await getLatestDocumentNlpJob({
    documentId: req.params.id,
    userId: user.id,
  });
  if (!status) {
    const document = await getDocument(req.params.id, user.id);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({
      job: null,
      documentStatus: document.nlp_status,
      summary: document.nlp_document_snapshot,
      revision: Number(document.revision),
      partitionRevision: Number(document.partition_revision),
    });
    return;
  }
  res.json({
    job: status,
    documentStatus: status.document_nlp_status,
    summary: status.nlp_document_snapshot,
    revision: Number(status.revision),
    partitionRevision: Number(status.partition_revision),
  });
});

router.use('/:id/citations', (req, _res, next) => {
  if (!environmentFlag('MCP_CITATION_V2_ENABLED', true)) {
    const error = new Error('Citation workflows are not enabled.');
    error.statusCode = 503;
    error.publicCode = 'CITATION_PROVIDER_UNAVAILABLE';
    next(error);
    return;
  }
  next();
});

router.post('/:id/citations/check', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document || document.trashed) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  if (document.academic_style === 'Customized') {
    const error = new Error('Choose APA, MLA, or Chicago before checking citations.');
    error.statusCode = 409;
    error.publicCode = 'CITATION_STYLE_REQUIRED';
    throw error;
  }
  const result = runCitationCheck({
    documentId: document.id,
    revision: Number(document.revision),
    partitionRevision: Number(document.partition_revision),
    blocks: document.blocks,
    styleName: citationStyleFromAcademicStyle(document.academic_style),
  });
  const cached = await findCitationResult({
    documentId: document.id,
    documentRevision: Number(document.revision),
    partitionRevision: Number(document.partition_revision),
    workflow: result.workflow,
    requestFingerprint: result.requestFingerprint,
  });
  if (cached) {
    res.json({ result: cached.result_json, cached: true, correlationId });
    return;
  }
  await saveCitationResult({
    documentId: document.id,
    documentRevision: Number(document.revision),
    partitionRevision: Number(document.partition_revision),
    workflow: result.workflow,
    requestFingerprint: result.requestFingerprint,
    result,
  });
  req.app.get('eventPublisher')?.publishCitationWorkflow?.({
    authUserId: user.auth_user_id,
    documentId: document.id,
    revision: document.revision,
    partitionRevision: document.partition_revision,
    workflow: result.workflow,
    status: 'completed',
    correlationId,
    result: {
      unresolvedCount: result.unresolved.length,
      orphanedCount: result.orphaned.length,
    },
  });
  res.status(201).json({ result, cached: false, correlationId });
});

router.post('/:id/citations/convert-style', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const targetAcademicStyle = String(req.body?.targetAcademicStyle ?? '');
  const targetStyleSettings = req.body?.targetStyleSettings;
  if (
    !['APA', 'MLA', 'Chicago'].includes(targetAcademicStyle)
    || !targetStyleSettings
    || typeof targetStyleSettings !== 'object'
    || Array.isArray(targetStyleSettings)
    || !Number.isInteger(req.body?.expectedRevision)
    || !Number.isInteger(req.body?.expectedPartitionRevision)
  ) {
    throw invalidInput('Citation template conversion settings are invalid.');
  }
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const converted = await convertDocumentCitationStyle({
    documentId: req.params.id,
    userId: user.id,
    targetAcademicStyle,
    targetStyleSettings,
    expectedRevision: req.body.expectedRevision,
    expectedPartitionRevision: req.body.expectedPartitionRevision,
  });
  if (!converted) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const document = await getDocument(req.params.id, user.id);
  const mutationId = mutationIdFromRequest(req);
  publishDocument(req, user, 'document:updated', document, mutationId, {
    citationStyleConversion: {
      targetAcademicStyle,
      bibliographyChanges: converted.plan.bibliographyChanges.length,
      inlineChanges: converted.plan.inlineChanges.length,
    },
  });
  publishVersion(req, user, document, converted.version, mutationId);
  res.json({
    document,
    version: converted.version,
    conversion: {
      workflowVersion: converted.plan.workflowVersion,
      sourceStyleName: converted.plan.sourceStyleName,
      targetStyleName: converted.plan.targetStyleName,
      bibliographyChanges: converted.plan.bibliographyChanges.length,
      inlineChanges: converted.plan.inlineChanges.length,
      verification: {
        unresolved: converted.plan.verification.unresolved.length,
        orphaned: converted.plan.verification.orphaned.length,
        formattingIssues: converted.plan.verification.formattingIssues.length,
      },
    },
    correlationId,
  });
});

router.post('/:id/citations/search', aiRateLimiter, async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const queryText = String(req.body?.query ?? '').trim();
  const author = String(req.body?.author ?? '').trim();
  const year = String(req.body?.year ?? '').trim();
  if (queryText.length < 3 || queryText.length > 500) {
    throw invalidInput('A literature query between 3 and 500 characters is required.');
  }
  if (author.length > 120 || (year && !/^(?:19|20)\d{2}$/u.test(year))) {
    throw invalidInput('Citation search filters are invalid.');
  }
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document || document.trashed) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  try {
    const result = await searchLiteratureQuery({
      query: queryText,
      ...(author ? { author } : {}),
      ...(year ? { year } : {}),
    });
    res.json({
      ...result,
      identity: {
        documentId: document.id,
        revision: Number(document.revision),
        partitionRevision: Number(document.partition_revision),
      },
      correlationId,
    });
  } catch (cause) {
    const error = new Error('Citation provider search is temporarily unavailable.', { cause });
    error.statusCode = 503;
    error.publicCode = 'CITATION_PROVIDER_UNAVAILABLE';
    error.correlationId = correlationId;
    throw error;
  }
});

router.post('/:id/citations/render', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await getDocument(req.params.id, user.id);
  if (!document || document.trashed) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  try {
    const rendered = renderCitationStyle({
      metadata: req.body?.metadata,
      styleName: req.body?.styleName,
      mode: req.body?.mode,
    });
    res.json({
      citation: rendered,
      identity: {
        documentId: document.id,
        revision: Number(document.revision),
        partitionRevision: Number(document.partition_revision),
      },
      correlationId,
    });
  } catch (cause) {
    const error = new Error('Citation rendering failed.', { cause });
    error.statusCode = 422;
    error.publicCode = 'CITATION_RENDER_FAILED';
    error.correlationId = correlationId;
    throw error;
  }
});

router.post('/:id/citations/apply-patch', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const anchor = req.body?.anchor;
  const replacementText = String(req.body?.replacementText ?? '');
  if (
    !anchor
    || anchor.documentId !== req.params.id
    || !UUID_PATTERN.test(anchor.blockId)
    || !/^[a-f0-9]{64}$/iu.test(String(anchor.blockTextHash ?? ''))
    || !Number.isInteger(anchor.partitionGeneration)
    || anchor.partitionGeneration < 0
    || !Number.isInteger(anchor.citationStartCp)
    || !Number.isInteger(anchor.citationEndCp)
    || anchor.citationStartCp < 0
    || anchor.citationEndCp < anchor.citationStartCp
    || typeof anchor.originalText !== 'string'
    || countCodePoints(anchor.originalText) > 4_000
    || replacementText.length > 4_000
    || !Number.isInteger(req.body?.expectedRevision)
    || !Number.isInteger(req.body?.expectedPartitionRevision)
  ) {
    throw invalidInput('Citation patch identity is invalid.');
  }
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const applied = await applyCitationPatch({
    documentId: req.params.id,
    userId: user.id,
    expectedRevision: req.body.expectedRevision,
    expectedPartitionRevision: req.body.expectedPartitionRevision,
    anchor,
    replacementText,
  });
  if (!applied) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const document = await getDocument(req.params.id, user.id);
  publishDocument(req, user, 'document:updated', document, mutationIdFromRequest(req), {
    citationPatch: {
      blockId: applied.blockId,
      rendererVersion: CITATION_RENDERER_VERSION,
    },
  });
  publishVersion(req, user, document, applied.version, mutationIdFromRequest(req));
  res.json({ applied, document, correlationId });
});

router.get('/:id/blocks/:blockId/nlp', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const block = await getOwnedBlockForNlp({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!block) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }
  const nlp = normalizePersistedBlockNlp(block);
  const summary = await getDocumentNlpSummary(req.params.id);
  res.json({
    block: {
      id: block.id,
      status: block.status,
      partitionGeneration: Number(block.partition_generation),
      ...nlp,
    },
    documentSummary: summary,
    identity: {
      documentId: req.params.id,
      blockId: req.params.blockId,
      sourceTextHash: nlp.sourceHash,
      partitionGeneration: Number(block.partition_generation),
      pipelineVersion: nlp.nlpPipelineVersion,
      documentRevision: Number(block.revision),
      partitionRevision: Number(block.partition_revision),
    },
  });
});

router.post('/:id/blocks/:blockId/nlp/check', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  if (!environmentFlag('NLP_LIVE_BLOCK_CHECK_ENABLED', true)) {
    throw new NlpError(
      NLP_ERROR_CODES.NOT_AVAILABLE,
      'Automatic language review is disabled.',
      { status: 503, correlationId: correlationIdFromRequest(req) },
    );
  }
  const expectedTextHash = String(req.body?.sourceTextHash ?? '');
  const expectedPartitionGeneration = Number(req.body?.partitionGeneration);
  const requestedText = req.body?.text === undefined
    ? null
    : String(req.body.text);
  const requestedSourceType = String(req.body?.sourceType ?? 'paragraph').trim();
  if (!/^[a-f0-9]{64}$/iu.test(expectedTextHash) || !Number.isInteger(expectedPartitionGeneration)) {
    throw invalidInput('The writing block changed before review could begin. Try again.');
  }
  if (requestedText !== null && (
    countCodePoints(requestedText) > 100_000
    || hashBlockText(requestedText) !== expectedTextHash
  )) {
    throw invalidInput('The submitted text changed before review could begin. Try again.');
  }
  if (!/^[a-z][a-zA-Z]{0,79}$/u.test(requestedSourceType)) {
    throw invalidInput('The writing block type is invalid.');
  }
  if (
    req.body?.knownTerms !== undefined
    && (
      !Array.isArray(req.body.knownTerms)
      || req.body.knownTerms.length > 100
      || req.body.knownTerms.some((term) => typeof term !== 'string' || term.length > 120)
    )
  ) {
    throw invalidInput('Known terms must be a short array of strings.');
  }
  const correlationId = correlationIdFromRequest(req);
  res.set('X-Correlation-Id', correlationId);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const block = await getOwnedBlockForNlp({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!block) {
    if (requestedText === null) {
      res.status(404).json({ error: 'Writing block not found' });
      return;
    }
    const document = await getDocument(req.params.id, user.id);
    if (!document || document.trashed) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const temporary = await analyzeTemporaryBlock({
      text: requestedText,
      sourceType: requestedSourceType,
      knownTerms: req.body?.knownTerms ?? [],
      correlationId,
      requestId: correlationId,
    });
    res.status(200).json({
      nlp: temporary,
      block: null,
      documentSummary: document.nlp_document_snapshot ?? {},
      persisted: false,
      identity: {
        documentId: req.params.id,
        blockId: req.params.blockId,
        sourceTextHash: expectedTextHash,
        partitionGeneration: expectedPartitionGeneration,
        pipelineVersion: temporary.pipelineVersion,
        nlpSnapshotFingerprint: createNlpSnapshotFingerprint(
          temporary,
          document.nlp_semantic_profile,
        ),
        documentRevision: Number(document.revision),
        partitionRevision: Number(document.partition_revision),
      },
      correlationId,
    });
    return;
  }
  const result = await analyzeTemporaryBlock({
    text: requestedText ?? block.text_content,
    sourceType: requestedText === null
      ? (block.attrs?.sourceType ?? 'paragraph')
      : requestedSourceType,
    knownTerms: req.body?.knownTerms ?? [],
    correlationId,
    requestId: correlationId,
  });
  const canonical = (
    hashBlockText(block.text_content) === expectedTextHash
    && Number(block.partition_generation) === expectedPartitionGeneration
  );
  if (!canonical) {
    res.status(200).json({
      nlp: result,
      block: null,
      documentSummary: block.nlp_document_snapshot ?? {},
      persisted: false,
      identity: {
        documentId: req.params.id,
        blockId: req.params.blockId,
        sourceTextHash: expectedTextHash,
        partitionGeneration: expectedPartitionGeneration,
        pipelineVersion: result.pipelineVersion,
        nlpSnapshotFingerprint: createNlpSnapshotFingerprint(
          result,
          block.nlp_semantic_profile,
        ),
        documentRevision: Number(block.revision),
        partitionRevision: Number(block.partition_revision),
      },
      correlationId,
    });
    return;
  }
  const saved = await saveBlockNlpResult({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
    expectedTextHash,
    expectedPartitionGeneration,
    result,
  });
  if (saved.stale) {
    throw new NlpError(
      NLP_ERROR_CODES.STALE_BLOCK_CONTEXT,
      'The writing block changed before language review completed.',
      { status: 409, correlationId },
    );
  }
  const document = await getDocument(req.params.id, user.id);
  publishDocument(req, user, 'block:nlp-updated', document, mutationIdFromRequest(req), {
    block: saved.block,
    identity: saved.identity,
    documentSummary: saved.summary,
  });
  res.status(201).json({
    nlp: result,
    block: saved.block,
    documentSummary: saved.summary,
    identity: saved.identity,
    correlationId,
    persisted: true,
  });
});

router.post('/:id/blocks/:blockId/nlp/issues/reject', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  requireUuid(req.params.blockId, 'Block ID');
  const expectedTextHash = String(req.body?.sourceTextHash ?? '');
  const expectedPartitionGeneration = Number(req.body?.partitionGeneration);
  const issue = req.body?.issue;
  if (
    !/^[a-f0-9]{64}$/iu.test(expectedTextHash)
    || !Number.isInteger(expectedPartitionGeneration)
    || !issue
    || typeof issue.code !== 'string'
    || !Number.isInteger(issue.startCp)
    || !Number.isInteger(issue.endCp)
  ) {
    throw invalidInput('The writing suggestion identity is invalid.');
  }
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const block = await getOwnedBlockForNlp({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!block) {
    res.status(404).json({ error: 'Writing block not found' });
    return;
  }
  const current = normalizePersistedBlockNlp(block);
  if (
    !current.current
    || current.sourceHash !== expectedTextHash
    || Number(block.partition_generation) !== expectedPartitionGeneration
  ) {
    throw new NlpError(
      NLP_ERROR_CODES.STALE_BLOCK_CONTEXT,
      'The writing block changed before the suggestion could be rejected.',
      { status: 409, correlationId: correlationIdFromRequest(req) },
    );
  }
  const reviewed = rejectLanguageIssue(current.nlpAnalysis, issue);
  const saved = await saveBlockNlpResult({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
    expectedTextHash,
    expectedPartitionGeneration,
    result: reviewed,
  });
  if (!saved.found) {
    res.status(404).json({ error: 'Writing block not found' });
    return;
  }
  if (saved.stale) {
    throw new NlpError(
      NLP_ERROR_CODES.STALE_BLOCK_CONTEXT,
      'The writing block changed before the suggestion could be rejected.',
      { status: 409, correlationId: correlationIdFromRequest(req) },
    );
  }
  const document = await getDocument(req.params.id, user.id);
  publishDocument(req, user, 'block:nlp-updated', document, mutationIdFromRequest(req), {
    block: saved.block,
    identity: saved.identity,
    documentSummary: saved.summary,
  });
  res.json({
    nlp: reviewed,
    block: saved.block,
    documentSummary: saved.summary,
    identity: saved.identity,
    persisted: true,
  });
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

router.delete('/:id/discard-empty', async (req, res) => {
  requireUuid(req.params.id, 'Document ID');
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const result = await discardEmptyDocument(req.params.id, user.id);
  if (!result) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (result.deleted) {
    const mutationId = mutationIdFromRequest(req);
    publishDeletedDocument(req, result.document, mutationId);
    await publishProgress(req, user, result.document, mutationId);
  }
  res.json(result);
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
  let context = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!context) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }

  let nlpSnapshot = normalizePersistedBlockNlp(context);
  if (!nlpSnapshot.current) {
    ai.stage('nlp-refresh', { sourceTextHash: hashBlockText(context.text_content) });
    const nlpResult = await analyzeTemporaryBlock({
      text: context.text_content,
      sourceType: context.attrs?.sourceType ?? 'paragraph',
      correlationId: ai.correlationId,
      requestId: ai.correlationId,
    });
    const savedNlp = await saveBlockNlpResult({
      documentId: context.document_id,
      blockId: context.id,
      userId: user.id,
      expectedTextHash: hashBlockText(context.text_content),
      expectedPartitionGeneration: Number(context.partition_generation),
      result: nlpResult,
    });
    if (savedNlp.stale) {
      throw new NlpError(
        NLP_ERROR_CODES.STALE_BLOCK_CONTEXT,
        'The writing block changed before coaching could begin.',
        { status: 409, correlationId: ai.correlationId },
      );
    }
    context = await getOwnedBlockContext({
      documentId: req.params.id,
      blockId: req.params.blockId,
      userId: user.id,
    });
    nlpSnapshot = normalizePersistedBlockNlp(context);
  }

  const sourceTextHash = hashBlockText(context.text_content);
  const filterSignature = analysisFilterSignature(filters);
  const model = process.env.OPENAI_ANALYSIS_MODEL || 'gpt-5.4-mini';
  ai.stage('cache-lookup', { sourceTextHash });
  const cached = await findCachedBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    partitionGeneration: Number(context.partition_generation),
    filterSignature,
    nlpSnapshotFingerprint: nlpSnapshot.nlpSnapshotFingerprint,
    model,
    promptVersion: BLOCK_ANALYSIS_PROMPT_VERSION,
  });
  if (cached) {
    res.json({
      analysis: formatBlockAnalysis(cached),
      cached: true,
      identity: {
        documentId: context.document_id,
        blockId: context.id,
        sourceTextHash,
        partitionGeneration: Number(context.partition_generation),
        nlpSnapshotFingerprint: nlpSnapshot.nlpSnapshotFingerprint,
      },
      correlationId: ai.correlationId,
    });
    return;
  }

  const deterministicMetrics = computeDeterministicMetrics(context.text_content);
  const sourceLookup = await lookupAcademicSourcesViaMcp(context.text_content);
  ai.stage('provider-request', { sourceTextHash });
  const generated = await generateBlockAnalysis({
    context,
    filters,
    sourceLookup,
    nlpContext: {
      status: nlpSnapshot.nlpStatus,
      issues: nlpSnapshot.nlpAnalysis?.issues ?? [],
      semanticCoherence: nlpSnapshot.semanticCoherence,
      semanticAnchor: nlpSnapshot.semanticAnchor,
      pipelineVersion: nlpSnapshot.nlpPipelineVersion,
      snapshotFingerprint: nlpSnapshot.nlpSnapshotFingerprint,
    },
  });
  ai.stage('persistence', { sourceTextHash });
  const saved = await saveBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    partitionGeneration: Number(context.partition_generation),
    filterSignature,
    nlpSnapshotFingerprint: nlpSnapshot.nlpSnapshotFingerprint,
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
    identity: {
      documentId: context.document_id,
      blockId: context.id,
      sourceTextHash,
      partitionGeneration: Number(context.partition_generation),
      nlpSnapshotFingerprint: nlpSnapshot.nlpSnapshotFingerprint,
    },
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
  let context = await getOwnedBlockContext({
    documentId: req.params.id,
    blockId: req.params.blockId,
    userId: user.id,
  });
  if (!context) {
    res.status(404).json({ error: 'Document block not found' });
    return;
  }
  const rewriteGateEnabled = environmentFlag('NLP_REWRITE_GATE_ENABLED', true);
  if (
    rewriteGateEnabled
    &&
    !isRewriteEligibleBlock(context)
    && normalizePersistedBlockNlp(context).nlpStatus === 'unknown'
  ) {
    ai.stage('nlp-gate-refresh');
    const refreshed = await analyzeTemporaryBlock({
      text: context.text_content,
      sourceType: context.attrs?.sourceType ?? 'paragraph',
      requestId: ai.correlationId,
    });
    await saveBlockNlpResult({
      documentId: req.params.id,
      blockId: req.params.blockId,
      userId: user.id,
      expectedTextHash: hashBlockText(context.text_content),
      expectedPartitionGeneration: Number(context.partition_generation),
      result: refreshed,
    });
    context = await getOwnedBlockContext({
      documentId: req.params.id,
      blockId: req.params.blockId,
      userId: user.id,
    });
  }
  if (rewriteGateEnabled && !isRewriteEligibleBlock(context)) {
    throw new NlpError(
      NLP_ERROR_CODES.REWRITE_BLOCKED,
      'Review the writing checks for this block before requesting a rewrite.',
      { status: 422, correlationId: ai.correlationId },
    );
  }

  const tones = [tone];
  const sourceTextHash = hashBlockText(context.text_content);
  const model = process.env.OPENAI_REWRITE_MODEL || 'gpt-5.4-mini';
  const nlpContext = rewriteGateEnabled
    ? compileNlpRewriteSupplement(context)
    : compileNlpRewriteSupplement({});
  const effectivePromptVersion = nlpAwareRewritePromptVersion(
    preferenceContext.promptVersion,
    nlpContext,
  );
  const identity = {
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    partitionGeneration: Number(context.partition_generation) || 0,
    tone,
    model,
    promptVersion: effectivePromptVersion,
    nlpSupplementFingerprint: nlpContext.fingerprint,
    nlpSnapshotFingerprint: normalizePersistedBlockNlp(context).nlpSnapshotFingerprint,
    nlpStatus: normalizePersistedBlockNlp(context).nlpStatus,
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
      promptVersion: effectivePromptVersion,
      nlpSupplementFingerprint: nlpContext.fingerprint,
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
  const generated = await generateBlockRewrites({
    context,
    tone,
    preferenceContext,
    nlpContext,
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
    || Number(freshContext.partition_generation) !== identity.partitionGeneration
    || (rewriteGateEnabled && !isRewriteEligibleBlock(freshContext))
    || (rewriteGateEnabled
      && compileNlpRewriteSupplement(freshContext).fingerprint !== nlpContext.fingerprint)
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
      promptVersion: effectivePromptVersion,
      effectivePreferences: preferenceContext.effectivePreferences,
      compiledPreferenceSupplement: preferenceResult?.supplement ?? '',
      preferenceWarnings: [
        ...(preferenceContext.warnings ?? []),
        ...(preferenceResult?.warnings ?? []),
      ],
      preferenceSchemaVersion: preferenceContext.schemaVersion,
      preferenceCompilerVersion: preferenceContext.compilerVersion,
      nlpSupplementFingerprint: nlpContext.fingerprint,
      compiledNlpSupplement: nlpContext.supplement,
      nlpSnapshot: nlpContext.snapshot,
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
  const practiceNlp = normalizePersistedBlockNlp(context);
  if (
    environmentFlag('NLP_REWRITE_GATE_ENABLED', true)
    && (
      !practiceNlp.current
      || !['pass', 'warning'].includes(practiceNlp.nlpStatus)
    )
  ) {
    throw new NlpError(
      'REWRITE_BLOCKED_BY_NLP',
      'Practice is unavailable until this block passes the writing checks.',
      { status: 409, correlationId: ai.correlationId },
    );
  }
  const latestAnalysis = await findLatestBlockAnalysis({
    documentId: context.document_id,
    blockId: context.id,
    sourceTextHash,
    partitionGeneration: Number(context.partition_generation),
    nlpSnapshotFingerprint: practiceNlp.nlpSnapshotFingerprint,
    promptVersion: BLOCK_ANALYSIS_PROMPT_VERSION,
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
