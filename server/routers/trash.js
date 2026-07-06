import { Router } from 'express';
import { getOrCreateTestUser } from '../models/users.js';
import {
  deleteDocumentForever,
  listDocuments,
  restoreDocument,
} from '../models/documents.js';

const router = Router();

router.get('/', async (_req, res) => {
  const user = await getOrCreateTestUser();
  const documents = await listDocuments({
    userId: user.id,
    trashed: true,
    sort: 'most_recent',
  });
  res.json({ documents });
});

router.post('/:id/restore', async (req, res) => {
  const user = await getOrCreateTestUser();
  const document = await restoreDocument(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

router.delete('/:id', async (req, res) => {
  const user = await getOrCreateTestUser();
  const document = await deleteDocumentForever(req.params.id, user.id);
  if (!document) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document });
});

export default router;
