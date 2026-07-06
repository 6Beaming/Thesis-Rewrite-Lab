import pg from 'pg';

const { Pool } = pg;

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/project_thesis_rewriter';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
