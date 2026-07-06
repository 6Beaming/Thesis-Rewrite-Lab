const fs = require('fs/promises');
const path = require('path');
const pg = require('pg');

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/project_thesis_rewriter';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const schemaSql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    const user = await client.query(
      `
        insert into users (email, display_name)
        values ($1, $2)
        on conflict (email)
        do update set display_name = excluded.display_name
        returning id
      `,
      ['test@example.com', 'test@example']
    );
    await client.query(
      `
        insert into user_stats (user_id)
        values ($1)
        on conflict (user_id) do nothing
      `,
      [user.rows[0].id]
    );
    await client.query('commit');
    console.log('Seeded test@example.com');
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
