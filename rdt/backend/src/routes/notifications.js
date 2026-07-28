// REQ-RDT-COMMENT-03: simple @mention notifications — badge counter + list, nothing more.
// Purely informational: reading/marking-read here never touches transaction state.
const express = require('express');
const { Client } = require('pg');
const { requireUser } = require('../middleware/auth');
const { loadDirectory } = require('../dataUserClient');

const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const directory = await loadDirectory();
    const notifRes = await client.query(
      `SELECT n.id, n.comment_id, n.created_at, n.read_at,
              c.body, c.author_user_id, c.transaction_id,
              t.dinas_inisiasi, t.dinas_target
       FROM rdt.notifications n
       JOIN rdt.comments c ON c.id = n.comment_id
       JOIN rdt.transactions t ON t.id = c.transaction_id
       WHERE n.recipient_user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.rdtUser.id]
    );
    const notifications = notifRes.rows.map((n) => ({
      id: n.id,
      comment_id: n.comment_id,
      body: n.body,
      author_user_id: n.author_user_id,
      author_display_name: (directory[n.author_user_id] && directory[n.author_user_id].display_name) || n.author_user_id,
      dinas_inisiasi: n.dinas_inisiasi,
      dinas_target: n.dinas_target,
      created_at: n.created_at,
      read_at: n.read_at,
    }));
    const unreadCount = notifications.filter((n) => !n.read_at).length;
    res.json({ ok: true, unread_count: unreadCount, notifications });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

router.post('/mark-read', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(
      'UPDATE rdt.notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL',
      [req.rdtUser.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

module.exports = router;
