// One-time cleanup for the notification-privacy bug (mentionRules.js's filterMentionsToPair,
// 4 Agu fix). Finds notification rows created BEFORE that fix where the recipient's own dinas
// doesn't match the comment's actual (dinas_inisiasi, dinas_target) pair and they aren't TAB —
// i.e. rows that leaked a comment/pair's existence to someone outside it — and deletes ONLY
// those specific rows. The comment itself, and any other recipient's own (correctly-scoped)
// notification row for the same comment, are left untouched.
//
// Usage: node tools/cleanupLeakedNotifications.js (rdt/backend must already be running on :4000
// for the /api/directory call; DATABASE_URL loaded via dotenv same as every other tool here)
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const dirRes = await fetch('http://localhost:4000/api/directory', { headers: { 'X-User-Id': 'demo-tab' } });
    const dirJson = await dirRes.json();
    const directory = dirJson.directory;

    const r = await c.query(`
      SELECT n.id AS notif_id, n.recipient_user_id, t.dinas_inisiasi, t.dinas_target
      FROM rdt.notifications n
      JOIN rdt.comments c ON c.id = n.comment_id
      JOIN rdt.transactions t ON t.id = c.transaction_id
    `);

    const leaked = [];
    for (const row of r.rows) {
      const entry = directory[row.recipient_user_id];
      if (!entry) continue;
      if (entry.role === 'TAB') continue;
      const dinasUpper = String(entry.dinas).toUpperCase();
      const allowed = [row.dinas_inisiasi, row.dinas_target].filter(Boolean).map((d) => String(d).toUpperCase());
      if (!allowed.includes(dinasUpper)) {
        leaked.push({ notif_id: row.notif_id, recipient: row.recipient_user_id, recipient_dinas: entry.dinas, pair: `${row.dinas_inisiasi}->${row.dinas_target}` });
      }
    }

    console.log('Found', leaked.length, 'leaked notification row(s):');
    console.table(leaked);

    if (leaked.length) {
      const ids = leaked.map((l) => l.notif_id);
      const del = await c.query('DELETE FROM rdt.notifications WHERE id = ANY($1) RETURNING id', [ids]);
      console.log('Deleted', del.rowCount, 'leaked notification row(s).');
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
