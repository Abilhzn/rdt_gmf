// Checklist 2.1 (12 Agu) — companion to tools/backupDatabase.js. Loads a backup JSON file's row
// data into a target schema that ALREADY HAS the structure applied (run sql/schema.sql +
// sql/migrations/*.sql against the target database first — same as a fresh install, see
// rdt/CLAUDE.md section 5 — this script never creates tables itself).
//
// SAFETY: defaults to restoring into a schema called `rdt_restore_test`, NOT `rdt` — restoring
// over the live schema by accident would silently duplicate-key-conflict or overwrite real data.
// Pass --target=rdt explicitly (and know what you're doing — this is a real production schema)
// if you actually mean to restore into it, e.g. rebuilding a wiped database from scratch.
//
// Usage: node tools/restoreDatabase.js <path-to-backup.json> [--target=schema_name]
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const filePath = process.argv[2];
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const targetSchema = targetArg ? targetArg.split('=')[1] : 'rdt_restore_test';

if (!filePath) {
  console.error('Usage: node tools/restoreDatabase.js <path-to-backup.json> [--target=schema_name]');
  process.exit(1);
}

// Insert order matters — children after the parents their FKs point to (mirrors sql/schema.sql's
// own table order). Extra tables the backup doesn't know about are simply skipped.
const TABLE_ORDER = [
  'dinas', 'uploads', 'transactions', 'export_batches', 'ledger_entries',
  'dinas_mapping', 'exclusion_rules', 'comments', 'audit_log', 'export_subdocs',
  'notifications', 'period_deadlines',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot restore.');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Restoring backup taken at ${dump.taken_at} into schema "${targetSchema}"...`);

  // Batched multi-row INSERT (not one row per round trip) — a large table (transactions can
  // easily be thousands of rows) sent one INSERT at a time over a pooled connection is what
  // actually broke this the first time this tool ran for real (checklist 2.1, 12 Agu): the
  // pooler dropped the connection partway through. BATCH_SIZE keeps each statement's bind
  // parameter count comfortably under Postgres's 65535 limit even for the widest table
  // (transactions, ~76 columns) and keeps individual round trips short.
  const BATCH_SIZE = 500;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const table of TABLE_ORDER) {
      const rows = dump.tables[table];
      if (!rows || !rows.length) { console.log(`  ${table}: 0 rows (skip)`); continue; }
      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(', ');
      await client.query('BEGIN');
      try {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const chunk = rows.slice(i, i + BATCH_SIZE);
          const valueRows = [];
          const values = [];
          chunk.forEach((row, rowIdx) => {
            const placeholders = columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
            valueRows.push(`(${placeholders.join(', ')})`);
            columns.forEach((c) => values.push(row[c]));
          });
          await client.query(
            `INSERT INTO ${targetSchema}.${table} (${colList}) VALUES ${valueRows.join(', ')} ON CONFLICT DO NOTHING`,
            values
          );
        }
        await client.query('COMMIT');
        console.log(`  ${table}: ${rows.length} rows restored`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Restore complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('Restore failed:', err); process.exit(1); });
