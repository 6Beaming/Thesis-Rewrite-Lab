// Applies both the Auth.js tables and the product tables required by the
// signed-in app surface. It runs when you use: npm run db:migrate.
// Running it repeatedly is safe because the SQL files use IF NOT EXISTS.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../server/models/auth-adapter.js';

const pool = createPostgresPool(process.env.DATABASE_URL);

try {
  const authMigration = await readFile(
    new URL('../server/models/migrations/001_auth.sql', import.meta.url),
    'utf8'
  );
  const productSchema = await readFile(
    new URL('../scripts/db/schema.sql', import.meta.url),
    'utf8'
  );
  await pool.query(authMigration);
  await pool.query(productSchema);
  await pool.query(
    `
      delete from users
      where email = 'test@example.com'
    `
  );
  console.log('PostgreSQL authentication and product schema are ready.');
} finally {
  await pool.end();
}
