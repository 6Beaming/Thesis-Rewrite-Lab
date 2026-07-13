import { Router } from 'express';
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

const router = Router();
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

async function extractBlocks(file) {
  return resolveDocumentUpload({ buffer: file.buffer, filename: file.originalname });
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

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const blocks = await extractBlocks(req.file);
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
