// One-time transition script for the migration-tracking fix (4 Agu, see migrate.js's header
// comment on rdt._migrations_applied). Run ONCE, by hand, against an EXISTING database that
// already has all current sql/migrations/*.sql files' effects applied (this dev DB included) —
// seeds the tracking table so migrate.js's next boot doesn't try to re-run them from scratch
// against data that no longer matches their (now-outdated) constraints.
//
// Do NOT run this against a genuinely fresh/empty database — that would mark every migration as
// "already applied" without ever actually running them, leaving the schema stuck at whatever
// schema.sql alone provides. A fresh install's migrate.js run already handles the empty case
// correctly on its own (empty tracking table -> every migration runs once, in order).
//
// Usage: node tools/backfillMigrationsApplied.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: conn });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS rdt._migrations_applied (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const migrationsDir = path.join(__dirname, '..', 'sql', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await client.query('INSERT INTO rdt._migrations_applied (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
      console.log('marked already-applied:', file);
    }
    console.log(`Done — ${files.length} migration file(s) marked as already applied.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
