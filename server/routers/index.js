import { Router } from 'express';
import documentsRouter from './documents.js';
import trashRouter from './trash.js';
import usersRouter from './users.js';
import {
  loadAuthSession,
  requireAuth,
} from '../middlewares/requireAuth.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/users', usersRouter);
router.use('/documents', documentsRouter);
router.use('/trash', trashRouter);

router.get('/me', loadAuthSession, requireAuth, (_req, res) => {
  res.json({ user: res.locals.session.user });
});

export default router;
