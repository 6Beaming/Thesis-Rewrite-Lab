import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ExpressAuth } from '@auth/express';
import path from 'path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'url';
import {
  appOrigin,
  authConfig,
  closeAuthDatabase,
  getAuthSession,
} from './server/auth.js';
import { requireTrustedAuthHost } from './server/middlewares/requireAuth.js';
import { closeDatabase } from './server/models/db.js';
import { userOwnsActiveDocument } from './server/models/documents.js';
import { getOrCreateUserFromSession } from './server/models/users.js';
import { getSubscriptionForUserId } from './server/models/subscriptions.js';
import { attachRealtimeServer } from './server/realtime/index.js';
import { createEventPublisher } from './server/realtime/publisher.js';
import apiRouter from './server/routers/index.js';
import { stripeWebhookHandler } from './server/routers/stripe.js';
import { errorHandler, notFound } from './server/middlewares/errors.js';
import { createRewriteWorker } from './server/ai/rewriteWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Hide the Express name and support the proxy server used after deployment.
app.disable('x-powered-by');
app.set(
  'trust proxy',
  Number.isNaN(Number(process.env.TRUST_PROXY_HOPS))
    ? 1
    : Number(process.env.TRUST_PROXY_HOPS || 1),
);

// Add browser security settings, allow requests only from this frontend, and
// reject JSON request bodies that are too large.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': [
          "'self'",
          'data:',
          'https://lh3.googleusercontent.com',
        ],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
app.use(
  cors({
    origin: appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Mutation-Id'],
  }),
);

// Stripe signs the original bytes. This route must be mounted before the
// global JSON parser, and is authenticated only by Stripe's signature.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler,
);
app.use(express.json({ limit: '15mb' }));

// Prevent one client from sending too many sign-in requests.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

// Send every /auth/... request to Auth.js.
app.use(
  /^\/auth\/(.*)$/,
  requireTrustedAuthHost,
  authRateLimiter,
  ExpressAuth(authConfig),
);

// The application's own API endpoints start with /api.
app.use('/api', apiRouter);
app.use('/api', notFound);

// In production, serve the built React app. Returning index.html for browser
// routes lets React Router open pages such as /profile.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.use(errorHandler);

const server = createServer(app);
const realtime = attachRealtimeServer(server, {
  origin: appOrigin,
  getSession: getAuthSession,
  resolveProductUser: getOrCreateUserFromSession,
  resolveSubscription: getSubscriptionForUserId,
  ownsDocument: userOwnsActiveDocument,
});
app.set('realtime', realtime);
const eventPublisher = createEventPublisher(realtime);
app.set('eventPublisher', eventPublisher);
const rewriteWorker = createRewriteWorker({ publisher: eventPublisher });
rewriteWorker.start();

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Close the server and database connection before the program stops.
async function shutDown() {
  rewriteWorker.stop();
  realtime.close();
  server.close();
  await Promise.allSettled([closeAuthDatabase(), closeDatabase()]);
}

process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);
