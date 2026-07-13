import { Router } from 'express';
import documentsRouter from './documents.js';
import trashRouter from './trash.js';
import usersRouter from './users.js';
import stripeRouter from './stripe.js';
import {
  loadAuthSession,
  requireAuth,
  loadProductUser,
  requirePro,
} from '../middlewares/requireAuth.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use(loadAuthSession, requireAuth, loadProductUser);

// Billing endpoints must remain available to authenticated Basic users.
router.use('/stripe', stripeRouter);

// All core product data and mutations require a verified paid entitlement.
router.use(requirePro);

router.use('/users', usersRouter);
router.use('/documents', documentsRouter);
router.use('/trash', trashRouter);

router.get('/me', (_req, res) => {
  res.json({ user: res.locals.session.user });
});

export default router;
