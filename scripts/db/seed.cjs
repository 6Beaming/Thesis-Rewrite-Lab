require('dotenv/config');
const fs = require('fs/promises');
const path = require('path');
const pg = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://thesis_rewriter:thesis_rewriter_dev@localhost:5432/thesis_rewriter';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const schemaSql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    await client.query('commit');
    console.log('Product schema is ready. Sign in with Google to create application users.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
