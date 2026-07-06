import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getSession } from '@auth/express';
import Google from '@auth/express/providers/google';
import { createAuthAdapter } from './models/auth-adapter.js';

const isProduction = process.env.NODE_ENV === 'production';

function parseOrigin(value) {
  const origin = new URL(value).origin;

  if (isProduction && !origin.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }

  return origin;
}

function loadGoogleCredentials() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required',
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

function loadAuthSecret() {
  if (process.env.AUTH_SECRET) {
    if (process.env.AUTH_SECRET.length < 32) {
      throw new Error('AUTH_SECRET must contain at least 32 characters');
    }
    return process.env.AUTH_SECRET;
  }

  if (isProduction) {
    throw new Error('AUTH_SECRET is required in production');
  }

  const secretPath = path.resolve('local/.auth-secret');
  mkdirSync(path.dirname(secretPath), { recursive: true });

  if (!existsSync(secretPath)) {
    try {
      writeFileSync(secretPath, randomBytes(32).toString('base64url'), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  return readFileSync(secretPath, 'utf8').trim();
}

export const appOrigin = parseOrigin(
  process.env.APP_ORIGIN || 'http://localhost:5173',
);

const databaseUrl = process.env.DATABASE_URL;
const googleCredentials = loadGoogleCredentials();
const { adapter, pool } = createAuthAdapter(databaseUrl);

export const authConfig = {
  adapter,
  basePath: '/auth',
  secret: loadAuthSecret(),
  trustHost: true,
  providers: [
    Google({
      ...googleCredentials,
      checks: ['pkce', 'state', 'nonce'],
      authorization: {
        params: {
          prompt: 'select_account',
          scope: 'openid email profile',
        },
      },
    }),
  ],
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: 'database',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  callbacks: {
    signIn({ account, profile }) {
      return (
        account?.provider === 'google' &&
        profile?.email_verified === true &&
        typeof profile.email === 'string'
      );
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

export function getAuthSession(request) {
  return getSession(request, authConfig);
}

export function closeAuthDatabase() {
  return pool.end();
}
