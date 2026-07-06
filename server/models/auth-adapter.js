/**
 * Runtime database interface between Auth.js and PostgreSQL.
 * All authentication PostgreSQL queries are centralized in `auth-adapter.js`, e.g. adapter.createUser(user);
 * Auth.js calls them during login, session loading, account linking, and sign-out:
 *
 * --- User Operations ---
 * @method createUser        - INSERT a new user
 * @method getUser           - SELECT user by ID
 * @method getUserByEmail    - SELECT user by email
 * @method updateUser        - UPDATE user information
 * @method deleteUser        - DELETE user
 *
 * --- Google Account-Link Operations ---
 * @method getUserByAccount  - Find user using Google account ID
 * @method linkAccount       - Link Google account to local user
 * @method unlinkAccount     - Remove the account link
 * @method getAccount        - Retrieve the linked account
 *
 * --- Session Operations ---
 * @method createSession     - INSERT a session
 * @method getSessionAndUser - Retrieve session and its user
 * @method updateSession     - UPDATE session expiry/details
 * @method deleteSession     - DELETE session during sign-out
 */
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

function sessionHash(sessionToken) {
  return createHash('sha256').update(sessionToken).digest('hex');
}

function toDate(value) {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Expected a valid date');
  }

  return date;
}

function rowToUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: toDate(row.email_verified),
    image: row.image,
  };
}

function rowToAccount(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    type: row.type,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
  };
}

function rowToSession(row, rawSessionToken) {
  if (!row) return null;

  return {
    sessionToken: rawSessionToken,
    userId: row.user_id,
    expires: toDate(row.expires),
  };
}

export class PostgresAuthStore {
  constructor(pool) {
    this.pool = pool;
  }

  async createUser(user) {
    const storedUser = {
      id: randomUUID(),
      name: user.name ?? null,
      email: user.email.trim().toLowerCase(),
      // Google is the only configured provider and unverified profiles are
      // rejected before this adapter is called.
      emailVerified: user.emailVerified ?? new Date(),
      image: user.image ?? null,
    };

    const result = await this.pool.query(
      `
        INSERT INTO auth_users
          (id, name, email, email_verified, image)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, email, email_verified, image
      `,
      [
        storedUser.id,
        storedUser.name,
        storedUser.email,
        storedUser.emailVerified,
        storedUser.image,
      ],
    );

    return rowToUser(result.rows[0]);
  }

  async getUser(id) {
    const result = await this.pool.query(
      `
        SELECT id, name, email, email_verified, image
        FROM auth_users
        WHERE id = $1
      `,
      [id],
    );
    return rowToUser(result.rows[0]);
  }

  async getUserByEmail(email) {
    const result = await this.pool.query(
      `
        SELECT id, name, email, email_verified, image
        FROM auth_users
        WHERE email = $1
      `,
      [email.trim().toLowerCase()],
    );
    return rowToUser(result.rows[0]);
  }

  async getUserByAccount({ provider, providerAccountId }) {
    const result = await this.pool.query(
      `
        SELECT users.id, users.name, users.email, users.email_verified, users.image
        FROM auth_users AS users
        INNER JOIN auth_accounts AS accounts ON accounts.user_id = users.id
        WHERE accounts.provider = $1 AND accounts.provider_account_id = $2
      `,
      [provider, providerAccountId],
    );
    return rowToUser(result.rows[0]);
  }

  async updateUser(user) {
    const current = await this.getUser(user.id);
    if (!current) {
      throw new Error('Cannot update an unknown user');
    }

    const updated = {
      ...current,
      ...user,
      email: (user.email ?? current.email).trim().toLowerCase(),
      emailVerified:
        user.emailVerified === undefined
          ? current.emailVerified
          : user.emailVerified,
    };

    const result = await this.pool.query(
      `
        UPDATE auth_users
        SET
          name = $2,
          email = $3,
          email_verified = $4,
          image = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, email, email_verified, image
      `,
      [
        updated.id,
        updated.name ?? null,
        updated.email,
        toDate(updated.emailVerified),
        updated.image ?? null,
      ],
    );

    return rowToUser(result.rows[0]);
  }

  async deleteUser(userId) {
    const result = await this.pool.query(
      `
        DELETE FROM auth_users
        WHERE id = $1
        RETURNING id, name, email, email_verified, image
      `,
      [userId],
    );
    return rowToUser(result.rows[0]);
  }

  async linkAccount(account) {
    const result = await this.pool.query(
      `
        INSERT INTO auth_accounts
          (user_id, type, provider, provider_account_id)
        VALUES ($1, $2, $3, $4)
        RETURNING user_id, type, provider, provider_account_id
      `,
      [
        account.userId,
        account.type,
        account.provider,
        account.providerAccountId,
      ],
    );

    // Access, refresh, and ID tokens are deliberately not persisted because
    // this application only uses Google for identity.
    return rowToAccount(result.rows[0]);
  }

  async unlinkAccount({ provider, providerAccountId }) {
    const result = await this.pool.query(
      `
        DELETE FROM auth_accounts
        WHERE provider = $1 AND provider_account_id = $2
        RETURNING user_id, type, provider, provider_account_id
      `,
      [provider, providerAccountId],
    );
    return rowToAccount(result.rows[0]);
  }

  async getAccount(providerAccountId, provider) {
    const result = await this.pool.query(
      `
        SELECT user_id, type, provider, provider_account_id
        FROM auth_accounts
        WHERE provider = $1 AND provider_account_id = $2
      `,
      [provider, providerAccountId],
    );
    return rowToAccount(result.rows[0]);
  }

  async createSession(session) {
    await this.pool.query(
      'DELETE FROM auth_sessions WHERE expires <= $1',
      [new Date()],
    );

    const result = await this.pool.query(
      `
        INSERT INTO auth_sessions (token_hash, user_id, expires)
        VALUES ($1, $2, $3)
        RETURNING user_id, expires
      `,
      [
        sessionHash(session.sessionToken),
        session.userId,
        toDate(session.expires),
      ],
    );

    return rowToSession(result.rows[0], session.sessionToken);
  }

  async getSessionAndUser(sessionToken) {
    const tokenHash = sessionHash(sessionToken);
    const result = await this.pool.query(
      `
        SELECT
          sessions.user_id AS session_user_id,
          sessions.expires AS session_expires,
          users.id,
          users.name,
          users.email,
          users.email_verified,
          users.image
        FROM auth_sessions AS sessions
        INNER JOIN auth_users AS users ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1
      `,
      [tokenHash],
    );
    const row = result.rows[0];

    if (!row) return null;

    if (toDate(row.session_expires) <= new Date()) {
      await this.pool.query(
        'DELETE FROM auth_sessions WHERE token_hash = $1',
        [tokenHash],
      );
      return null;
    }

    return {
      session: {
        sessionToken,
        userId: row.session_user_id,
        expires: toDate(row.session_expires),
      },
      user: rowToUser(row),
    };
  }

  async updateSession(session) {
    const tokenHash = sessionHash(session.sessionToken);
    const currentResult = await this.pool.query(
      `
        SELECT user_id, expires
        FROM auth_sessions
        WHERE token_hash = $1
      `,
      [tokenHash],
    );
    const current = currentResult.rows[0];

    if (!current) return null;

    const updated = {
      sessionToken: session.sessionToken,
      userId: session.userId ?? current.user_id,
      expires:
        session.expires === undefined ? toDate(current.expires) : session.expires,
    };

    const result = await this.pool.query(
      `
        UPDATE auth_sessions
        SET
          user_id = $2,
          expires = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE token_hash = $1
        RETURNING user_id, expires
      `,
      [tokenHash, updated.userId, toDate(updated.expires)],
    );

    return rowToSession(result.rows[0], session.sessionToken);
  }

  async deleteSession(sessionToken) {
    const result = await this.pool.query(
      `
        DELETE FROM auth_sessions
        WHERE token_hash = $1
        RETURNING user_id, expires
      `,
      [sessionHash(sessionToken)],
    );
    return rowToSession(result.rows[0], sessionToken);
  }
}

export function createPostgresPool(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  pool.on('error', (error) => {
    console.error(
      'Unexpected PostgreSQL pool error:',
      error instanceof Error ? error.name : 'UnknownError',
    );
  });
  return pool;
}

export function createAuthAdapter(connectionString) {
  const pool = createPostgresPool(connectionString);
  const store = new PostgresAuthStore(pool);

  return {
    pool,
    store,
    adapter: {
      createUser: (user) => store.createUser(user),
      getUser: (id) => store.getUser(id),
      getUserByEmail: (email) => store.getUserByEmail(email),
      getUserByAccount: (account) => store.getUserByAccount(account),
      updateUser: (user) => store.updateUser(user),
      deleteUser: (id) => store.deleteUser(id),
      linkAccount: (account) => store.linkAccount(account),
      unlinkAccount: (account) => store.unlinkAccount(account),
      getAccount: (providerAccountId, provider) =>
        store.getAccount(providerAccountId, provider),
      createSession: (session) => store.createSession(session),
      getSessionAndUser: (token) => store.getSessionAndUser(token),
      updateSession: (session) => store.updateSession(session),
      deleteSession: (token) => store.deleteSession(token),
    },
  };
}
