// Tests the adapter without modifying your Docker database. 
// It creates a temporary in-memory PostgreSQL-compatible database and verifies:
// - Google user registration and account linking
// - Session-token hashing
// - Expired-session deletion
// It runs with: npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { newDb } from 'pg-mem';
import { PostgresAuthStore } from './auth-adapter.js';

let pool;
let store;

beforeEach(async () => {
  const database = newDb({ autoCreateForeignKeyIndices: true });
  const postgres = database.adapters.createPg();
  pool = new postgres.Pool();
  store = new PostgresAuthStore(pool);

  const migration = await readFile(
    new URL('./migrations/001_auth.sql', import.meta.url),
    'utf8',
  );
  await pool.query(migration);
});

afterEach(async () => {
  await pool.end();
});

test('registers and retrieves a Google user and account', async () => {
  const user = await store.createUser({
    name: 'Test Writer',
    email: 'Writer@Example.com',
    emailVerified: null,
    image: null,
  });

  await store.linkAccount({
    userId: user.id,
    type: 'oidc',
    provider: 'google',
    providerAccountId: 'google-subject-1',
  });

  assert.equal(user.email, 'writer@example.com');
  assert.ok(user.emailVerified instanceof Date);
  assert.deepEqual(
    await store.getUserByAccount({
      provider: 'google',
      providerAccountId: 'google-subject-1',
    }),
    user,
  );
});

test('stores only a hash of an active session token', async () => {
  const user = await store.createUser({
    name: 'Test Writer',
    email: 'writer@example.com',
    emailVerified: new Date(),
    image: null,
  });
  const session = {
    sessionToken: 'raw-secret-session-token',
    userId: user.id,
    expires: new Date(Date.now() + 60_000),
  };

  await store.createSession(session);

  const persisted = await pool.query(
    'SELECT token_hash FROM auth_sessions',
  );
  assert.notEqual(persisted.rows[0].token_hash, session.sessionToken);
  assert.deepEqual(await store.getSessionAndUser(session.sessionToken), {
    session,
    user,
  });
});

test('rejects expired sessions and removes them', async () => {
  const user = await store.createUser({
    name: 'Test Writer',
    email: 'writer@example.com',
    emailVerified: new Date(),
    image: null,
  });
  const token = 'expired-session-token';

  await store.createSession({
    sessionToken: token,
    userId: user.id,
    expires: new Date(Date.now() - 1_000),
  });

  assert.equal(await store.getSessionAndUser(token), null);

  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM auth_sessions',
  );
  assert.equal(result.rows[0].count, 0);
});
