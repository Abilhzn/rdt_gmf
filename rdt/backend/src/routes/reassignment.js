// Resolution of DECLINED transactions by the initiator dinas.
//   - BORNE_BY_INITIATOR is a pure status change: no ledger_entries rows are written, since
//     no budget actually moves cross-dinas when the initiator absorbs the cost themselves.
//   - REASSIGN overwrites dinas_target on the SAME transaction row rather than creating a new
//     one; reassigned_from + reassign_count capture the trail, full history stays in rdt.audit_log.
//   - reassign_count is capped at 3 — further REASSIGN attempts are rejected (400) and the
//     initiator must choose BORNE_BY_INITIATOR, a hard stop rather than a silent auto-conversion.
//   - Eligible REASSIGN targets exclude the original uploader and the dinas that just declined —
//     both would trivially re-produce the situation just resolved.
//   - REASSIGN does not re-run Excel prefix normalization/exclusion checks — the new target is
//     chosen directly from the active rdt.dinas list, since there's no Excel remark left to derive one from.

const express = require('express');
const { Client } = require('pg');
const { requireUser, requireDinasAccess } = require('../middleware/auth');
const { validateReassignTarget, buildValidCodeMap } = require('../rules/reassignmentRules');
const { validateFreeText } = require('../rules/textValidation');
const { logRollbackAudit } = require('../logger');

const router = express.Router();

router.use(requireUser);

// Shared per-row resolve logic (item 10 reuses this inside one batch transaction instead of
// duplicating the BORNE/REASSIGN branching). Caller owns the client/transaction lifecycle —
// this only runs the SELECT...FOR UPDATE + validation + write for a single id, and throws
// (with .httpStatus) on any failure so the caller's existing ROLLBACK-on-catch handles it.
async function resolveOneDeclined(client, user, { id, action, newTarget, note, ip }) {
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
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [user.id, id, 'BORNE_BY_INITIATOR', 'DECLINED', 'BORNE_BY_INITIATOR', JSON.stringify({ dinas_inisiasi: row.dinas_inisiasi, note }), ip]
    );
  } else {
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = buildValidCodeMap(validRes.rows);
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

    // periode_efektif=NULL: the DECLINE that got us here already snapshotted a value for the OLD
    // pasangan, but this row is starting a fresh confirm/reject episode under newTargetUpper, a
    // DIFFERENT pasangan with its own deadline — a new snapshot gets written when it resolves.
    await client.query(
      `UPDATE rdt.transactions
       SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from=$2, reassign_count=reassign_count+1,
           decided_by_user_id=NULL, decided_at=NULL, periode_efektif=NULL
       WHERE id=$3`,
      [newTargetUpper, row.dinas_target, id]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [user.id, id, 'REASSIGN', 'DECLINED', 'PENDING', JSON.stringify({ from_dinas: row.dinas_target, to_dinas: newTargetUpper, reassign_count: row.reassign_count + 1, note }), ip]
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
  // Length-capped free text.
  const noteCheck = validateFreeText(req.body && req.body.note, { fieldLabel: 'Catatan' });
  if (!noteCheck.ok) return res.status(400).json(noteCheck);
  const note = noteCheck.value;
  const user = req.rdtUser;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await resolveOneDeclined(client, user, { id, action, newTarget, note, ip: req.ip });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const status = err.httpStatus || 500;
    const category = await logRollbackAudit(client, { userId: user.id, req, err, route: req.originalUrl, transactionId: id });
    res.status(status).json({ ok: false, error: String(err.message || err), error_category: category });
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
  // Length-capped free text.
  const noteCheck = validateFreeText(req.body && req.body.note, { fieldLabel: 'Catatan' });
  if (!noteCheck.ok) return res.status(400).json(noteCheck);
  const note = noteCheck.value;
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
        ip: req.ip,
      });
    }
    await client.query('COMMIT');
    res.json({ ok: true, resolved_count: items.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const status = err.httpStatus || 500;
    const category = await logRollbackAudit(client, { userId: user.id, req, err, route: req.originalUrl });
    res.status(status).json({ ok: false, error: String(err.message || err), error_category: category });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
