// Applies server/models/migrations/001_auth.sql to create the authentication tables and indexes.
// It runs when you use: npm run db:migrate
// It closes the database connection afterward. Running it repeatedly is safe because the SQL uses IF NOT EXISTS
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../server/models/auth-adapter.js';

const pool = createPostgresPool(process.env.DATABASE_URL);

try {
  const migration = await readFile(
    new URL('../server/models/migrations/001_auth.sql', import.meta.url),
    'utf8',
  );
  await pool.query(migration);
  console.log('PostgreSQL authentication schema is ready.');
} finally {
  await pool.end();
}
