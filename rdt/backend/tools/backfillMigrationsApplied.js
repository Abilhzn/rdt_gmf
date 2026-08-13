// One-time transition script for the migration-tracking fix (4 Agu, see migrate.js's header
// comment on rdt._migrations_applied). Run ONCE, by hand, against an EXISTING database that
// already has all current sql/migrations/*.sql files' effects applied (this dev DB included) —
// seeds the tracking table so migrate.js's next boot doesn't try to re-run them from scratch
// against data that no longer matches their (now-outdated) constraints.
//
// DANGER (audit finding, 13 Agu — root-cause candidate for the "transactions_dinas_target_fkey"
// bug, SRS.md "Bug ditemukan 8 Agu, PRIORITAS TERTINGGI"): this script does ZERO verification
// that a migration it's about to mark "applied" actually ran. It just blindly writes every
// filename in sql/migrations/ to rdt._migrations_applied. If it's ever run against a database
// where migrations only PARTIALLY succeeded (e.g. 005_real_dinas_roster.sql failed or was never
// run), it permanently marks 005 as done anyway — migrate.js will then skip it on every future
// boot, forever, since its whole design is "run each file at most once, ever". The database gets
// stuck with an incomplete rdt.dinas roster (missing TV/TX/TZ/DFR/TMM/etc — see 005/010's
// content) with no self-healing path left, until someone manually deletes the wrongly-backfilled
// row(s) from rdt._migrations_applied or drops+re-migrates the schema entirely. This is likely
// EXACTLY how that FK bug happened on a live Supabase project.
//
// Do NOT run this against a genuinely fresh/empty database — that would mark every migration as
// "already applied" without ever actually running them, leaving the schema stuck at whatever
// schema.sql alone provides. A fresh install's migrate.js run already handles the empty case
// correctly on its own (empty tracking table -> every migration runs once, in order).
//
// SAFETY CHECK (added 13 Agu): before writing anything, this script now verifies a handful of
// fingerprints spanning the full migration range (early/mid/late) actually exist in the target
// database — if any is missing, it refuses to backfill and exits with a clear error instead of
// silently marking that migration (and everything after the point it stopped being safe to
// assume) as done. This can't prove EVERY migration ran (that would mean re-deriving this whole
// script's logic per-file, not worth it for a one-off transition tool — see FINGERPRINTS below
// for exactly what IS and ISN'T covered), but it catches the dangerous case of backfilling a
// database that's meaningfully behind, which is what actually happened here.
//
// Usage: node tools/backfillMigrationsApplied.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// One representative check per era of the migration history — NOT one per file (that's what the
// migrations themselves are for). If the database doesn't even have the EARLIEST fingerprint,
// backfilling would be catastrophically wrong (marks everything done, ran nothing); missing only
// the LATEST fingerprint still means real migrations in between would get wrongly skipped.
const FINGERPRINTS = [
  {
    label: 'migration 005 (real dinas roster) — rdt.dinas should have the full ~28-row GH roster, not the 21-row synthetic placeholder',
    check: async (client) => {
      const r = await client.query(`SELECT COUNT(*)::int AS c FROM rdt.dinas WHERE code IN ('TV','TX','TZ','DFR')`);
      return r.rows[0].c === 4;
    },
  },
  {
    label: 'migration 011 (persist sub_group) — rdt.transactions.sub_group column',
    check: async (client) => {
      const r = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='rdt' AND table_name='transactions' AND column_name='sub_group'`);
      return r.rows.length === 1;
    },
  },
  {
    label: 'migration 017 (periode_efektif snapshot) — rdt.transactions.periode_efektif column',
    check: async (client) => {
      const r = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='rdt' AND table_name='transactions' AND column_name='periode_efektif'`);
      return r.rows.length === 1;
    },
  },
  {
    label: 'migration 020 (period default deadlines) — rdt.period_default_deadlines table',
    check: async (client) => {
      const r = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='rdt' AND table_name='period_default_deadlines'`);
      return r.rows.length === 1;
    },
  },
];

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: conn });
  await client.connect();
  try {
    console.log('Checking fingerprints before backfilling — refusing to mark anything "applied" that doesn\'t look genuinely applied...');
    const failures = [];
    for (const fp of FINGERPRINTS) {
      const ok = await fp.check(client);
      console.log(`  [${ok ? 'OK' : 'MISSING'}] ${fp.label}`);
      if (!ok) failures.push(fp.label);
    }
    if (failures.length) {
      console.error(`\nRefusing to backfill: ${failures.length} fingerprint(s) missing — this database is NOT fully migrated.`);
      console.error('Run migrate.js normally instead (it will apply whatever is actually missing), or investigate why these are absent before considering a backfill.');
      process.exit(1);
    }
    console.log('All fingerprints present — proceeding with backfill.\n');

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
