/**
 * Migration runner — port dari `rdt/backend/src/migrate.js` (logika sama: apply schema.sql,
 * lalu migrations/*.sql berurutan, idempoten via tabel tracking). SQL di `sql/` di-copy apa
 * adanya dari backend lama, tidak ditulis ulang.
 *
 * Standalone script (bukan lewat DI Nest) — dipanggil lewat `npm run migrate`.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import configuration from '../../config/configuration';

const SQL_DIR = path.join(__dirname, '..', '..', '..', 'sql');
const MIGRATIONS_TABLE = 'rdt._migrations_applied';

async function runMigrations(): Promise<void> {
  const { database } = configuration();
  const pool = new Pool(database);
  try {
    const schemaSql = fs.readFileSync(path.join(SQL_DIR, 'schema.sql'), 'utf8');
    await pool.query(schemaSql);

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );

    const migrationsDir = path.join(SQL_DIR, 'migrations');
    const appliedRes = await pool.query<{ filename: string }>(
      `SELECT filename FROM ${MIGRATIONS_TABLE}`,
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip (already applied): ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
      await pool.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`,
        [file],
      );
      console.log(`applied: ${file}`);
    }

    console.log('Migrations OK');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err: unknown) => {
    console.error('Migration error', err);
    process.exit(1);
  });
}

export { runMigrations };
