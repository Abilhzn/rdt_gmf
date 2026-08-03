const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { validateReassignTarget } = require('../rules/reassignmentRules');
const { resolveMentionedUserIds } = require('../rules/mentionRules');
const { loadDirectory } = require('../dataUserClient');

const router = express.Router();

// Mounted at /api/investigation in index.js. REQ-RDT-LEDGER-10: rows whose dinas signal was the
// exact literal "Ask TA" land in status NEEDS_INVESTIGATION with dinas_target still null — this
// is a queue only role TAB can see/act on, deliberately a NEW route (not routes/confirmation.js)
// because the action here is "assign the real dinas_target" (an investigation outcome), not
// Confirm/Decline — even though the underlying mechanics borrow reassignmentRules' target
// validation, same as routes/reassignment.js does.
router.use(requireUser, requireRole('TAB'));

// REQ-RDT-LEDGER-10 comment support (29 Jul, project owner request): "kasih kolom komentar biar
// ngasih keterangan kenapa di-assign ke dinas yang diajukan" — same reply-to-latest-top-level-
// or-new-top-level convention used by POST /api/persist (Repost) and
// POST /api/confirmation/:dinas/submit, just inlined here rather than shared (matches how those
// two routes each keep their own copy rather than a shared helper module). Posted on the NEWLY
// assigned (dinas_inisiasi, dinas_target) pair's thread, not the "Ask TA" investigation context —
// once assigned, that's the pair the explanation is actually about.
async function postPairComment(client, dinasInisiasi, dinasTarget, fallbackTransactionId, authorUserId, body) {
  const parentRes = await client.query(
    `SELECT c.id, c.transaction_id FROM rdt.comments c
     JOIN rdt.transactions t ON t.id = c.transaction_id
     WHERE t.dinas_inisiasi=$1 AND t.dinas_target=$2 AND c.parent_comment_id IS NULL
     ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
    [dinasInisiasi, dinasTarget]
  );
  const parent = parentRes.rows[0];
  const commentRes = await client.query(
    `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
    [parent ? parent.transaction_id : fallbackTransactionId, parent ? parent.id : null, authorUserId, body]
  );
  // REQ-RDT-COMMENT-03 (diperluas 3 Agu, gap found in sweep): this never notified anyone before —
  // not even the newly-assigned dinasTarget the comment is addressed to. Same union pattern as
  // every other note field now: implicit recipient (the dinas TAB just routed this to) plus
  // anyone explicitly @mentioned.
  const commentId = commentRes.rows[0].id;
  const directory = await loadDirectory();
  const recipientIds = new Set(resolveMentionedUserIds(body, directory));
  Object.keys(directory).forEach((id) => {
    if (String(directory[id].dinas).toUpperCase() === String(dinasTarget).toUpperCase()) recipientIds.add(id);
  });
  recipientIds.delete(authorUserId);
  for (const recipientId of recipientIds) {
    await client.query('INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)', [recipientId, commentId]);
  }
}

// GET /api/investigation — every row awaiting TAB's manual investigation, with enough context
// (Ref.Doc/Remarks + the source upload) for a human to actually resolve it.
router.get('/', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT t.id, t.sheet_name, t.raw_row_index, t.account, t.nominal, t.category, t.remark, t.ref_doc,
              t.dinas_inisiasi, t.upload_id, u.original_filename AS upload_filename, t.created_at
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.status_konfirmasi = 'NEEDS_INVESTIGATION'
       ORDER BY t.created_at ASC`
    );
    res.json({ ok: true, rows: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/investigation/:transactionId/assign — body: { dinas_target }. Moves the row to
// PENDING under the newly-determined dinas_target, so it enters the NORMAL confirmation flow
// from there (the newly-assigned dinas confirms/declines it — TAB's job here is just routing,
// per REQ-RDT-LEDGER-10's explicit "keputusan akhir tetap di tangan TAB sebagai manusia, sistem
// cuma memfasilitasi routing-nya, JANGAN dibuat otomatis menebak").
router.post('/:transactionId/assign', express.json(), async (req, res) => {
  const transactionId = req.params.transactionId;
  const newTarget = req.body && req.body.dinas_target;
  const description = req.body && req.body.description;
  const userId = req.rdtUser.id;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const q = await client.query(
      'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, reassign_count FROM rdt.transactions WHERE id=$1 FOR UPDATE',
      [transactionId]
    );
    if (!q.rows.length) throw new Error('transaction not found: ' + transactionId);
    const row = q.rows[0];
    if (row.status_konfirmasi !== 'NEEDS_INVESTIGATION') {
      throw new Error('transaction is not awaiting investigation: ' + transactionId);
    }
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = new Set(validRes.rows.map((r) => String(r.code).toUpperCase()));
    const validation = validateReassignTarget({
      newTarget,
      validCodes,
      dinasInisiasi: row.dinas_inisiasi,
      currentDinasTarget: row.dinas_target,
      reassignCount: row.reassign_count,
    });
    if (!validation.ok) throw new Error(validation.error);
    const newTargetUpper = validation.newTargetUpper;

    await client.query(
      `UPDATE rdt.transactions
       SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from='Ask TA',
           decided_by_user_id=NULL, decided_at=NULL
       WHERE id=$2`,
      [newTargetUpper, transactionId]
    );
    await client.query(
      'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)',
      [userId, transactionId, 'INVESTIGATION_RESOLVED', 'NEEDS_INVESTIGATION', 'PENDING', JSON.stringify({ assigned_to: newTargetUpper, resolved_by: userId })]
    );

    const trimmedDescription = description && String(description).trim();
    if (trimmedDescription) {
      await postPairComment(client, row.dinas_inisiasi, newTargetUpper, transactionId, userId, trimmedDescription);
    }

    await client.query('COMMIT');
    res.json({ ok: true, dinas_target: newTargetUpper });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

// POST /api/investigation/assign-all — body: { items: [{ transaction_id, dinas_target }], description }.
// REQ-RDT-LEDGER-10 batch action (29 Jul, project owner request), same "assign one-by-one or all
// at once" shape as Confirmation's declined-row batch resolve (routes/reassignment.js's
// resolveBatch) — but stricter: EVERY currently-open row must already have a chosen target
// before this can run at all (all-or-nothing gate), not just the ones the caller happens to
// include. The frontend enforces this by disabling the button; this is the defensive backend
// mirror of that rule, not just a UI nicety. One description, if given, becomes one comment per
// distinct (dinas_inisiasi, dinas_target) pair touched — mirrors POST /api/persist's per-pair
// comment fan-out.
router.post('/assign-all', express.json(), async (req, res) => {
  const items = req.body && req.body.items;
  const description = req.body && req.body.description;
  const userId = req.rdtUser.id;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: 'items is required and must be a non-empty array' });
  }
  if (items.some((it) => !it || !it.transaction_id || !it.dinas_target)) {
    return res.status(400).json({ ok: false, error: 'every item must have transaction_id and dinas_target — assign the ones you can individually, or pick a target for all of them before using Assign All' });
  }
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');

    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = new Set(validRes.rows.map((r) => String(r.code).toUpperCase()));

    const assigned = [];
    const pairTransactionId = new Map(); // "inisiasi target" -> a transaction id to anchor a new comment to
    for (const item of items) {
      const q = await client.query(
        'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, reassign_count FROM rdt.transactions WHERE id=$1 FOR UPDATE',
        [item.transaction_id]
      );
      if (!q.rows.length) throw new Error('transaction not found: ' + item.transaction_id);
      const row = q.rows[0];
      if (row.status_konfirmasi !== 'NEEDS_INVESTIGATION') {
        throw new Error('transaction is not awaiting investigation: ' + item.transaction_id);
      }
      const validation = validateReassignTarget({
        newTarget: item.dinas_target,
        validCodes,
        dinasInisiasi: row.dinas_inisiasi,
        currentDinasTarget: row.dinas_target,
        reassignCount: row.reassign_count,
      });
      if (!validation.ok) throw new Error(`id ${item.transaction_id}: ${validation.error}`);
      const newTargetUpper = validation.newTargetUpper;

      await client.query(
        `UPDATE rdt.transactions
         SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from='Ask TA',
             decided_by_user_id=NULL, decided_at=NULL
         WHERE id=$2`,
        [newTargetUpper, row.id]
      );
      await client.query(
        'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)',
        [userId, row.id, 'INVESTIGATION_RESOLVED', 'NEEDS_INVESTIGATION', 'PENDING', JSON.stringify({ assigned_to: newTargetUpper, resolved_by: userId, batch: true })]
      );
      assigned.push({ id: row.id, dinas_inisiasi: row.dinas_inisiasi, dinas_target: newTargetUpper });
      const pairKey = `${row.dinas_inisiasi} ${newTargetUpper}`;
      if (!pairTransactionId.has(pairKey)) pairTransactionId.set(pairKey, row.id);
    }

    const trimmedDescription = description && String(description).trim();
    if (trimmedDescription) {
      for (const [pairKey, fallbackTransactionId] of pairTransactionId) {
        const [dinasInisiasi, dinasTarget] = pairKey.split(' ');
        await postPairComment(client, dinasInisiasi, dinasTarget, fallbackTransactionId, userId, trimmedDescription);
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, assigned });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
