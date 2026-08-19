/**
 * Migration runner: executes sql/schema.sql against DATABASE_URL if present.
 * This is intentionally a separate script from request handlers.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// 21 = the real GH count — a safe floor that only a genuinely broken/incomplete migration state
// would fail (fully-migrated is ~28 with Corp + inactive placeholders). Pure predicate so the
// threshold is unit-testable without a real DB connection — used by the sanity check below.
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

    // Tracks which migration files have already run, so each one executes exactly once ever, not
    // once per boot — re-running an earlier migration's narrower CHECK constraint against data that
    // already uses a later, wider constraint would fail. schema.sql itself stays safely re-run every
    // time (IF NOT EXISTS/ON CONFLICT). An existing database needs this table backfilled once by
    // hand — see tools/backfillMigrationsApplied.js — since guessing "table missing -> already
    // applied" would be wrong on a genuinely fresh install.
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
    // Seed dinas (21 operational dinas, including TA which has its own dedicated PIC, plus Corp
    // which does not) if not present. This is a synthetic placeholder roster —
    // sql/migrations/005_real_dinas_roster.sql runs after this and is the source of truth.
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
    // Seed mapping examples — kept in sync with config/mapping.seed.json, since the parser's
    // DB-sourced mapping path reads from this table instead of the JSON file whenever
    // DATABASE_URL is set. Keep this seed complete (including self-mapped codes like 'Corp'->
    // 'Corp') rather than relying on excelParser.js's uppercase fallback for codes that already
    // have a known, deliberate self-mapping.
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

    // Sanity check: a database whose migration tracking got out of sync with reality ends up with
    // an incomplete rdt.dinas roster, which otherwise stays silent until a real upload hits a
    // dinas_target FK violation (looking like a parser bug, not a migration one). Catch it here,
    // loudly, at boot time instead.
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
