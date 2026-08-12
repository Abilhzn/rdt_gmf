// Checklist 2.1 (12 Agu) — manual database export, run by hand whenever ("terutama sebelum
// perubahan besar" per CHECKLIST_LAUNCH.md), not just relying on Supabase's own backup.
//
// Why this exists instead of `supabase db dump` (the tool docs/dump_db.md originally documented):
// that command needs Docker Desktop locally (Supabase CLI runs the actual pg_dump work inside a
// container) — not available on every dev machine. This is a pure Node/`pg` alternative with zero
// extra runtime dependency: dumps every table under the `rdt` schema to one JSON file (schema
// structure comes from sql/schema.sql + sql/migrations/*.sql, already version-controlled — this
// script is DATA only, restoring both together is what makes a real backup).
//
// Usage:  node tools/backupDatabase.js  (reads DATABASE_URL from rdt/backend/.env via dotenv)
// Output: <repo root>/../budgeting_gmf_backups/backup_<timestamp>.json — same directory
// docs/dump_db.md already tells you to use, deliberately OUTSIDE the git-tracked repo folder.
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'budgeting_gmf_backups');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot back up.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tablesRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'rdt' ORDER BY table_name`
    );
    const dump = { taken_at: new Date().toISOString(), tables: {} };
    let totalRows = 0;
    for (const { table_name: table } of tablesRes.rows) {
      const r = await client.query(`SELECT * FROM rdt.${table}`);
      dump.tables[table] = r.rows;
      totalRows += r.rowCount;
      console.log(`  ${table}: ${r.rowCount} rows`);
    }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outPath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(outPath, JSON.stringify(dump, null, 0));
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`\nBackup written: ${outPath} (${sizeKb} KB, ${tablesRes.rows.length} tables, ${totalRows} rows total)`);
    console.log('Restore this alongside sql/schema.sql + sql/migrations/*.sql (structure) — see tools/restoreDatabase.js.');
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('Backup failed:', err); process.exit(1); });
