/* The database blueprint. It creates:
auth_users
auth_accounts
auth_sessions
Foreign keys and 
indexes:
auth_accounts.user_id index: quickly finds accounts belonging to a user.
auth_sessions.user_id index: quickly finds a user’s sessions.
auth_sessions.expires index: quickly finds expired sessions.
*/

/*name, email, image are needed because, 
after sign-in, the app loads sessions from PostgreSQL 
without contacting Google again or storing Google tokens*/
CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMPTZ,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_accounts (
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx
  ON auth_accounts(user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
  ON auth_sessions(expires);
