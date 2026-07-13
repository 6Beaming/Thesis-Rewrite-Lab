import { Router } from 'express';
import { getOrCreateUserFromSession, getUserStats } from '../models/users.js';
import {
  deleteDocumentForever,
  listDocuments,
  restoreDocument,
} from '../models/documents.js';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mutationIdFromRequest(req) {
  const value = String(req.get('x-mutation-id') ?? '');
  return UUID_PATTERN.test(value) ? value : null;
}

async function publishProgress(req, user, document, mutationId) {
  const publisher = req.app.get('eventPublisher');
  if (!publisher) return;
  publisher.publishProgress({
    authUserId: req.res.locals.session.user.id,
    productUserId: user.id,
    stats: await getUserStats(user.id),
    documentId: document?.id ?? null,
    revision: document?.revision ?? null,
    mutationId,
  });
}

function requireDocumentId(value) {
  if (!UUID_PATTERN.test(String(value ?? ''))) {
    const error = new Error('Document ID must be a valid UUID');
    error.statusCode = 400;
    throw error;
  }
}

router.get('/', async (_req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const documents = await listDocuments({
    userId: user.id,
    trashed: true,
    sort: 'most_recent',
  });
  res.json({ documents });
});

router.post('/:id/restore', async (req, res) => {
  requireDocumentId(req.params.id);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await restoreDocument(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  const publisher = req.app.get('eventPublisher');
  publisher?.publishDocument({
    authUserId: req.res.locals.session.user.id,
    type: 'document:restored',
    document,
    mutationId,
  });
  await publishProgress(req, user, document, mutationId);
  res.json({ document });
});

router.delete('/:id', async (req, res) => {
  requireDocumentId(req.params.id);
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const document = await deleteDocumentForever(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const mutationId = mutationIdFromRequest(req);
  req.app.get('eventPublisher')?.publishDeletedDocument({
    authUserId: req.res.locals.session.user.id,
    document,
    mutationId,
  });
  await publishProgress(req, user, document, mutationId);
  res.json({ document });
});

export default router;
