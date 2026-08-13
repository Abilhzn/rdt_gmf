/**
 * Migration runner: executes sql/schema.sql against DATABASE_URL if present.
 * This is intentionally a separate script from request handlers.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// 21 = the real GH count (REQ-RDT-EXT/3.1.2's roster) — a safe floor that only a genuinely
// broken/incomplete migration state would fail (fully-migrated is ~28 with Corp + inactive
// placeholders TG/TK/TO/TT). Pure predicate, split out so the threshold logic is unit-testable
// without a real DB connection — see runMigrations()'s sanity check below for where it's used.
const MIN_EXPECTED_DINAS = 21;
function isDinasRosterComplete(count) {
  return count >= MIN_EXPECTED_DINAS;
}

async function runMigrations() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.log('DATABASE_URL not set — skipping migrations');
    return;
  }
  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    // sql directory is under rdt/backend/sql
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    // Bug found 4 Agu: this runner used to re-execute EVERY migration file on EVERY server
    // start, every time, forever, relying on each file's own SQL being idempotent (IF NOT
    // EXISTS / DROP...ADD CONSTRAINT). That assumption breaks the moment an EARLIER migration's
    // CHECK constraint is narrower than a LATER one's and real data using the later, wider set
    // already exists (e.g. migration 004's status_konfirmasi list predates 'SUPERSEDED' from
    // migration 013 — once a real SUPERSEDED row exists, re-running 004's ADD CONSTRAINT on the
    // next boot fails validation against it, even though 013 immediately re-widens it right
    // after). Track which files have already run in a small table instead, so each migration
    // executes exactly once ever, not once per boot — schema.sql stays re-run every time
    // (it's already written to be safely re-appliable via IF NOT EXISTS/ON CONFLICT). A fresh
    // install's tracking table starts empty and every migration runs once, in order, same as
    // always. An EXISTING database (this dev DB included) needs this table seeded once with
    // whichever migration files were already applied before this fix existed — see
    // scripts/backfillMigrationsApplied.js, run once by hand, not automatically here (auto-
    // guessing "table doesn't exist yet -> everything already applied" would be WRONG on a
    // genuinely fresh install with an empty database). See tools/backfillMigrationsApplied.js.
    await client.query(`CREATE TABLE IF NOT EXISTS rdt._migrations_applied (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    // Changes made after schema.sql was first applied live as separate files in
    // sql/migrations/, run in filename order — schema.sql itself is not edited retroactively.
    const migrationsDir = path.join(__dirname, '..', 'sql', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const appliedRes = await client.query('SELECT filename FROM rdt._migrations_applied');
      const applied = new Set(appliedRes.rows.map((r) => r.filename));
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO rdt._migrations_applied (filename) VALUES ($1)', [file]);
      }
    }
    console.log('Migrations applied');
    // Seed dinas (21 operational dinas, including TA which has its own dedicated PIC — REQ-RDT-AUTH-05
    // — plus Corp which does not) if not present. NOTE (29 Jul 2026): this is the same synthetic
    // placeholder roster as schema.sql's INSERT (see its comment) — sql/migrations/005_real_dinas_roster.sql
    // runs after this and is the current source of truth for the real GH names/roster, not this list.
    const dinasList = [
      ['TA','Dinas TA'],
      ['TB','Dinas TB'],['TC','Dinas TC'],['TD','Dinas TD'],['TE','Dinas TE'],['TF','Dinas TF'],
      ['TG','Dinas TG'],['TH','Dinas TH'],['TI','Dinas TI'],['TJ','Dinas TJ'],['TK','Dinas TK'],
      ['TL','Dinas TL'],['TM','Dinas TM'],['TN','Dinas TN'],['TO','Dinas TO'],['TP','Dinas TP'],
      ['TQ','Dinas TQ'],['TR','Dinas TR'],['TS','Dinas TS'],['TT','Dinas TT'],['TU','Dinas TU'],
      ['Corp','Corporate']
    ];
    for (const [code,name] of dinasList) {
      await client.query('INSERT INTO rdt.dinas(code,name) VALUES($1,$2) ON CONFLICT (code) DO NOTHING', [code,name]);
    }
    // seed mapping examples — kept in sync with config/mapping.seed.json (audit finding, 13 Agu:
    // this list used to only have 2 of the JSON file's 9 entries, and the parser's DB-sourced
    // mapping path (EXT-04 fix) reads FROM THIS TABLE now instead of the JSON file whenever
    // DATABASE_URL is set. The missing 'Corp'->'Corp' entry specifically caused a live FK
    // violation — see rdt/docs/SRS.md "Bug ditemukan 8 Agu, PRIORITAS TERTINGGI" — a self-mapped
    // code with no explicit DB row fell through to excelParser.js's uppercase-fallback branch,
    // producing 'CORP' (no match in rdt.dinas, which stores 'Corp' mixed-case) instead of 'Corp'.
    // That fallback branch is now fixed to preserve canonical casing regardless (see
    // buildAllowedCodes's header comment), but keeping this seed complete avoids relying on that
    // fallback for codes that already have a known, deliberate self-mapping.
    const mappingSeed = [
      ['TCR', 'TC'], ['TJ Plant', 'TJ'], ['TC', 'TC'], ['TF', 'TF'], ['TL', 'TL'], ['TN', 'TN'],
      ['Corp', 'Corp'], ['GMFTE', 'TE'], ['GMFCORP', 'Corp'],
    ];
    for (const [prefix, dinasCode] of mappingSeed) {
      await client.query('INSERT INTO rdt.dinas_mapping(prefix,dinas_code) VALUES($1,$2) ON CONFLICT (prefix) DO NOTHING', [prefix, dinasCode]);
    }
    // seed exclusion rules
    await client.query("INSERT INTO rdt.exclusion_rules(prefix,reason) VALUES('AUAK','Kategori internal') ON CONFLICT (prefix) DO NOTHING");
    await client.query("INSERT INTO rdt.exclusion_rules(prefix,reason) VALUES('PO','Purchase Order internal') ON CONFLICT (prefix) DO NOTHING");

    // Sanity check (audit finding, 13 Agu — root-cause candidate for the "transactions_
    // dinas_target_fkey" bug, SRS.md "Bug ditemukan 8 Agu, PRIORITAS TERTINGGI"): a database
    // whose migration tracking got out of sync with reality (see tools/backfillMigrationsApplied.js's
    // header comment for exactly how) ends up with an incomplete rdt.dinas roster — the real 21-GH
    // roster (migration 005) never landed, or a later addition (TMM/TAB/TZ/etc, migrations 010/014)
    // got skipped. That stays silent until a real upload hits a dinas_target FK violation, at which
    // point it looks like a parser bug, not a migration one. Catch it HERE, loudly, at boot time
    // instead — 21 is the real GH count (REQ-RDT-EXT/3.1.2's roster), Corp/inactive placeholders
    // (TG/TK/TO/TT) push the real fully-migrated count to ~28, so 21 is a safe floor that only a
    // genuinely broken/incomplete roster would fail.
    const dinasCountRes = await client.query('SELECT COUNT(*)::int AS c FROM rdt.dinas');
    const dinasCount = dinasCountRes.rows[0].c;
    if (!isDinasRosterComplete(dinasCount)) {
      throw new Error(
        `Sanity check failed: rdt.dinas has only ${dinasCount} row(s), expected at least ${MIN_EXPECTED_DINAS} ` +
        `(the real 21-GH roster from migration 005_real_dinas_roster.sql). This database's migration ` +
        `tracking (rdt._migrations_applied) is likely out of sync with what actually ran — see ` +
        `tools/backfillMigrationsApplied.js's header comment. Refusing to continue: an incomplete ` +
        `roster causes confusing "transactions_dinas_target_fkey" errors on real uploads, not a ` +
        `clean startup failure like this one. Investigate rdt._migrations_applied before retrying.`
      );
    }
  } catch (err) {
    console.error('Migration error', err);
    throw err;
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

module.exports = { runMigrations, isDinasRosterComplete, MIN_EXPECTED_DINAS };

if (require.main === module) {
  runMigrations().catch((e) => { console.error(e); process.exit(1); });
}
