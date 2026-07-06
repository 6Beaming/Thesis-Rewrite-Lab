import { Router } from 'express';
import documentsRouter from './documents.js';
import trashRouter from './trash.js';
import usersRouter from './users.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/users', usersRouter);
router.use('/documents', documentsRouter);
router.use('/trash', trashRouter);

export default router;
