import { Router } from 'express';
import {
  loadAuthSession,
  requireAuth,
} from '../middlewares/requireAuth.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/me', loadAuthSession, requireAuth, (_req, res) => {
  res.json({ user: res.locals.session.user });
});

export default router;
