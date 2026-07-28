/**
 * Migration runner: executes sql/schema.sql against DATABASE_URL if present.
 * This is intentionally a separate script from request handlers.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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

    // Changes made after schema.sql was first applied live as separate files in
    // sql/migrations/, run in filename order — schema.sql itself is not edited retroactively.
    const migrationsDir = path.join(__dirname, '..', 'sql', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
      }
    }
    console.log('Migrations applied');
    // Seed dinas (21 operational + TA/Corp, no dedicated PIC — see schema.sql's rdt.dinas seed
    // comment for why TA is a real dinas_target distinct from TAB) if not present
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
    // seed mapping examples
    await client.query("INSERT INTO rdt.dinas_mapping(prefix,dinas_code) VALUES('TCR','TC') ON CONFLICT (prefix) DO NOTHING");
    await client.query("INSERT INTO rdt.dinas_mapping(prefix,dinas_code) VALUES('TJ Plant','TJ') ON CONFLICT (prefix) DO NOTHING");
    // seed exclusion rules
    await client.query("INSERT INTO rdt.exclusion_rules(prefix,reason) VALUES('AUAK','Kategori internal') ON CONFLICT (prefix) DO NOTHING");
    await client.query("INSERT INTO rdt.exclusion_rules(prefix,reason) VALUES('PO','Purchase Order internal') ON CONFLICT (prefix) DO NOTHING");
  } catch (err) {
    console.error('Migration error', err);
    throw err;
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations().catch((e) => { console.error(e); process.exit(1); });
}
