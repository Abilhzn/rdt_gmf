const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { validateReassignTarget, buildValidCodeMap } = require('../rules/reassignmentRules');
const { resolveMentionedUserIds, filterMentionsToPair } = require('../rules/mentionRules');
const { loadDirectory } = require('../dataUserClient');
const { validateFreeText } = require('../rules/textValidation');

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
  // Privacy bug fix (4 Agu): a mention of a dinas outside THIS pair must not leak a notification
  // that reveals this pair's existence to them — see mentionRules.js's filterMentionsToPair.
  const mentioned = filterMentionsToPair(resolveMentionedUserIds(body, directory), directory, [dinasInisiasi, dinasTarget]);
  const recipientIds = new Set(mentioned);
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

// POST /api/investigation/:transactionId/assign — body: { dinas_target }.
//
// REQ-RDT-LEDGER-10 REVERSAL (5 Agu, DIBALIK from the 30 Jul "still needs normal confirm" call):
// this used to move the row to PENDING under the newly-determined dinas_target so it entered the
// NORMAL confirm flow there. Now it's the FINAL word — the project owner confirmed the dinas
// determination already happened through discussion OUTSIDE this system (WhatsApp etc.) before
// TAB ever clicks Assign here, so a second Ya/Tidak round-trip through the assigned dinas would
// just be re-litigating a decision that's already settled. The row goes straight to CONFIRMED,
// atomically with its ledger pair (DEBIT the assigned dinas, CREDIT the initiator) — same
// mechanics as routes/confirmation.js's 'YA' path, just triggered by TAB's assignment instead of
// the target dinas's own click. The assigned dinas can still SEE the transaction (it's a normal
// row with their code as dinas_target — every existing read path, e.g. Dashboard-Detailing's
// getPairTransactions, already shows every status, not just PENDING), just no action needed.
router.post('/:transactionId/assign', express.json(), async (req, res) => {
  const transactionId = req.params.transactionId;
  const newTarget = req.body && req.body.dinas_target;
  // Checklist 1.3 (12 Agu): was trusted with no length cap.
  const descriptionCheck = validateFreeText(req.body && req.body.description, { fieldLabel: 'Deskripsi' });
  if (!descriptionCheck.ok) return res.status(400).json(descriptionCheck);
  const description = descriptionCheck.value;
  const userId = req.rdtUser.id;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const q = await client.query(
      'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, reassign_count, nominal FROM rdt.transactions WHERE id=$1 FOR UPDATE',
      [transactionId]
    );
    if (!q.rows.length) throw new Error('transaction not found: ' + transactionId);
    const row = q.rows[0];
    if (row.status_konfirmasi !== 'NEEDS_INVESTIGATION') {
      throw new Error('transaction is not awaiting investigation: ' + transactionId);
    }
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = buildValidCodeMap(validRes.rows);
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
       SET dinas_target=$1, status_konfirmasi='CONFIRMED', reassigned_from='Ask TA',
           decided_by_user_id=$2, decided_at=now()
       WHERE id=$3`,
      [newTargetUpper, userId, transactionId]
    );
    await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [transactionId, newTargetUpper, 'DEBIT', row.nominal]);
    await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [transactionId, row.dinas_inisiasi, 'CREDIT', row.nominal]);
    await client.query(
      'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)',
      [userId, transactionId, 'INVESTIGATION_RESOLVED', 'NEEDS_INVESTIGATION', 'CONFIRMED', JSON.stringify({ assigned_to: newTargetUpper, resolved_by: userId, auto_confirmed: true })]
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
  // Checklist 1.3 (12 Agu): was trusted with no length cap.
  const descriptionCheck = validateFreeText(req.body && req.body.description, { fieldLabel: 'Deskripsi' });
  if (!descriptionCheck.ok) return res.status(400).json(descriptionCheck);
  const description = descriptionCheck.value;
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
    const validCodes = buildValidCodeMap(validRes.rows);

    const assigned = [];
    const pairTransactionId = new Map(); // "inisiasi target" -> a transaction id to anchor a new comment to
    for (const item of items) {
      const q = await client.query(
        'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, reassign_count, nominal FROM rdt.transactions WHERE id=$1 FOR UPDATE',
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

      // REQ-RDT-LEDGER-10 REVERSAL (5 Agu) — see single-assign route above for the full rationale:
      // straight to CONFIRMED + ledger pair, not PENDING.
      await client.query(
        `UPDATE rdt.transactions
         SET dinas_target=$1, status_konfirmasi='CONFIRMED', reassigned_from='Ask TA',
             decided_by_user_id=$2, decided_at=now()
         WHERE id=$3`,
        [newTargetUpper, userId, row.id]
      );
      await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [row.id, newTargetUpper, 'DEBIT', row.nominal]);
      await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [row.id, row.dinas_inisiasi, 'CREDIT', row.nominal]);
      await client.query(
        'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)',
        [userId, row.id, 'INVESTIGATION_RESOLVED', 'NEEDS_INVESTIGATION', 'CONFIRMED', JSON.stringify({ assigned_to: newTargetUpper, resolved_by: userId, batch: true, auto_confirmed: true })]
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
