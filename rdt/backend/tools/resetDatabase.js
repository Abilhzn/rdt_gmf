// Full wipe for local simulation resets: DROP SCHEMA rdt CASCADE, then re-run migrate.js
// (schema.sql + sql/migrations/* + seed data) so the DB comes back up exactly like a fresh
// install. Destructive — dev/simulation use only, not wired into `npm start`.
//
// Usage: node tools/resetDatabase.js  (reads DATABASE_URL from rdt/backend/.env via dotenv)
require('dotenv').config();
const { Client } = require('pg');
const { runMigrations } = require('../src/migrate');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot reset.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log('Dropping schema rdt...');
    await client.query('DROP SCHEMA IF EXISTS rdt CASCADE');
  } finally {
    await client.end();
  }
  console.log('Re-running migrations...');
  await runMigrations();
  console.log('Database reset complete — fresh state.');
}

main().catch((err) => { console.error('Reset failed:', err); process.exit(1); });
