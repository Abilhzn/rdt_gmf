// REQ-RDT-LEDGER-07 — resolution of DECLINED transactions by the initiator dinas.
//
// Decisions confirmed with the project owner before implementing this file:
//   - BORNE_BY_INITIATOR is a pure status change: no ledger_entries rows are written, since
//     no budget actually moves cross-dinas when the initiator absorbs the cost themselves.
//   - REASSIGN overwrites dinas_target on the SAME transaction row (per the literal text of
//     REQ-RDT-LEDGER-07) rather than creating a new row; reassigned_from + reassign_count
//     capture the trail, and full history remains in rdt.audit_log regardless.
//   - reassign_count is capped at 3: once a row has already been reassigned 3 times, further
//     REASSIGN attempts are rejected (400) and the initiator must choose BORNE_BY_INITIATOR —
//     this is a hard stop, not a silent auto-conversion, so the initiator makes that call
//     explicitly rather than the system deciding it for them.
//   - The eligible target-dinas list for REASSIGN excludes the original uploader
//     (dinas_inisiasi) and the dinas that just declined (the row's current dinas_target) —
//     both would trivially re-produce the situation just resolved.
//   - REASSIGN does not re-run Excel prefix normalization/exclusion checks — the new target
//     is chosen directly by the initiator from the active rdt.dinas list, since there's no
//     Excel remark to re-derive a prefix from at this point.

const express = require('express');
const { Client } = require('pg');
const { requireUser, requireDinasAccess } = require('../middleware/auth');
const { validateReassignTarget } = require('../rules/reassignmentRules');

const router = express.Router();

router.use(requireUser);

// Shared per-row resolve logic (item 10 reuses this inside one batch transaction instead of
// duplicating the BORNE/REASSIGN branching). Caller owns the client/transaction lifecycle —
// this only runs the SELECT...FOR UPDATE + validation + write for a single id, and throws
// (with .httpStatus) on any failure so the caller's existing ROLLBACK-on-catch handles it.
async function resolveOneDeclined(client, user, { id, action, newTarget, note }) {
  if (action !== 'BORNE' && action !== 'REASSIGN') {
    throw Object.assign(new Error("action must be 'BORNE' or 'REASSIGN'"), { httpStatus: 400 });
  }
  const q = await client.query(
    'SELECT id, status_konfirmasi, dinas_target, dinas_inisiasi, reassign_count FROM rdt.transactions WHERE id=$1 FOR UPDATE',
    [id]
  );
  if (!q.rows.length) throw Object.assign(new Error('transaction not found: ' + id), { httpStatus: 404 });
  const row = q.rows[0];

  if (user.role !== 'TAB' && String(user.dinas).toUpperCase() !== String(row.dinas_inisiasi).toUpperCase()) {
    throw Object.assign(new Error(`only the initiator dinas (${row.dinas_inisiasi}) or TAB may resolve this transaction`), { httpStatus: 403 });
  }
  if (row.status_konfirmasi !== 'DECLINED') {
    throw Object.assign(new Error('transaction is not DECLINED: ' + id), { httpStatus: 409 });
  }

  if (action === 'BORNE') {
    await client.query(
      `UPDATE rdt.transactions SET status_konfirmasi='BORNE_BY_INITIATOR', decided_by_user_id=$1, decided_at=now() WHERE id=$2`,
      [user.id, id]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)`,
      [user.id, id, 'BORNE_BY_INITIATOR', 'DECLINED', 'BORNE_BY_INITIATOR', JSON.stringify({ dinas_inisiasi: row.dinas_inisiasi, note })]
    );
  } else {
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = new Set(validRes.rows.map((r) => String(r.code).toUpperCase()));
    const validation = validateReassignTarget({
      newTarget,
      validCodes,
      dinasInisiasi: row.dinas_inisiasi,
      currentDinasTarget: row.dinas_target,
      reassignCount: row.reassign_count,
    });
    if (!validation.ok) {
      throw Object.assign(new Error(validation.error), { httpStatus: validation.httpStatus });
    }
    const newTargetUpper = validation.newTargetUpper;

    await client.query(
      `UPDATE rdt.transactions
       SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from=$2, reassign_count=reassign_count+1,
           decided_by_user_id=NULL, decided_at=NULL
       WHERE id=$3`,
      [newTargetUpper, row.dinas_target, id]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)`,
      [user.id, id, 'REASSIGN', 'DECLINED', 'PENDING', JSON.stringify({ from_dinas: row.dinas_target, to_dinas: newTargetUpper, reassign_count: row.reassign_count + 1, note })]
    );
  }
}

// GET /api/declined/:dinas — DECLINED transactions this dinas initiated, awaiting resolution.
router.get('/:dinas', requireDinasAccess('dinas'), async (req, res) => {
  const dinas = req.params.dinas;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT id, sheet_name, raw_row_index, account, nominal, category, remark, ref_doc, dinas_target, reassign_count
       FROM rdt.transactions WHERE dinas_inisiasi=$1 AND status_konfirmasi=$2`,
      [dinas, 'DECLINED']
    );
    res.json({ ok: true, rows: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/declined/:id/resolve — body { action: 'BORNE' | 'REASSIGN', new_dinas_target?, note? }
router.post('/:id/resolve', express.json(), async (req, res) => {
  const id = req.params.id;
  const action = req.body && req.body.action;
  const newTarget = req.body && req.body.new_dinas_target;
  // Optional free-text note (items 7/10) — stored in audit_log.detail (jsonb) rather than a
  // new schema column, since audit_log already carries free-form per-action context elsewhere.
  const note = (req.body && typeof req.body.note === 'string' && req.body.note.trim()) || null;
  const user = req.rdtUser;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await resolveOneDeclined(client, user, { id, action, newTarget, note });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const status = err.httpStatus || 500;
    res.status(status).json({ ok: false, error: String(err.message || err) });
  } finally { try { await client.end(); } catch (e) {} }
});

// POST /api/declined/batch-resolve — item 10 "Confirm All": body
//   { items: [{ id, action: 'BORNE'|'REASSIGN', new_dinas_target? }], note? }
// One shared optional note applies to every item in the batch. All items resolve inside a
// SINGLE BEGIN...COMMIT (not N independent HTTP calls) so a failure on any one item rolls back
// the whole batch rather than leaving some rows resolved and others still DECLINED — same
// atomicity convention as confirmation.js's submit endpoint. The one-item-at-a-time
// /:id/resolve endpoint above stays available unchanged.
router.post('/batch-resolve', express.json(), async (req, res) => {
  const items = req.body && req.body.items;
  const note = (req.body && typeof req.body.note === 'string' && req.body.note.trim()) || null;
  const user = req.rdtUser;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: 'invalid body, expected { items: [{id, action, new_dinas_target?}] }' });
  }
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    for (const item of items) {
      await resolveOneDeclined(client, user, {
        id: item.id,
        action: item.action,
        newTarget: item.new_dinas_target,
        note,
      });
    }
    await client.query('COMMIT');
    res.json({ ok: true, resolved_count: items.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const status = err.httpStatus || 500;
    res.status(status).json({ ok: false, error: String(err.message || err) });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
