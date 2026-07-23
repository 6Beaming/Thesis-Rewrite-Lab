import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createPostgresPool } from '../server/models/auth-adapter.js';

const pool = createPostgresPool(process.env.DATABASE_URL);
const migrationsDirectory = new URL('../server/models/migrations/', import.meta.url);

function migrationMetadata(filename, sql) {
  const match = /^(\d+)_.*\.sql$/.exec(filename);
  if (!match) return null;
  return {
    version: Number(match[1]),
    name: filename,
    checksum: createHash('sha256').update(sql).digest('hex'),
    sql,
  };
}

const client = await pool.connect();
try {
  await client.query('select pg_advisory_lock($1)', [91320260711]);
  await client.query(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null unique,
      checksum char(64) not null,
      applied_at timestamptz not null default now()
    )
  `);

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+_.*\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const migrations = [];
  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, migrationsDirectory), 'utf8');
    migrations.push(migrationMetadata(filename, sql));
  }

  for (const migration of migrations) {
    const applied = await client.query(
      'select name, checksum from schema_migrations where version = $1',
      [migration.version]
    );
    if (applied.rows[0]) {
      if (
        applied.rows[0].name !== migration.name
        || applied.rows[0].checksum.trim() !== migration.checksum
      ) {
        throw new Error(`Applied migration ${migration.version} does not match ${migration.name}`);
      }
      continue;
    }

    await client.query('begin');
    try {
      await client.query(migration.sql);
      await client.query(
        `insert into schema_migrations (version, name, checksum)
         values ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      );
      await client.query('commit');
      console.log(`Applied migration ${migration.name}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  console.log('PostgreSQL migrations are up to date.');
} finally {
  await client.query('select pg_advisory_unlock($1)', [91320260711]).catch(() => {});
  client.release();
  await pool.end();
}
