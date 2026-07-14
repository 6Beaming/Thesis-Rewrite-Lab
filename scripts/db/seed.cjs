require('dotenv/config');
const pg = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://thesis_rewriter:thesis_rewriter_dev@localhost:5432/thesis_rewriter';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      select version, name
      from schema_migrations
      order by version
    `);
    if (result.rowCount === 0) {
      throw new Error('No product migrations are applied. Run npm run db:migrate first.');
    }
    console.log(
      `Product schema is ready at migration ${result.rows.at(-1).version}. `
      + 'Sign in with Google to create application users.'
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
