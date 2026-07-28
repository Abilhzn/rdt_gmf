const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { validateReassignTarget } = require('../rules/reassignmentRules');

const router = express.Router();

// Mounted at /api/investigation in index.js. REQ-RDT-LEDGER-10: rows whose dinas signal was the
// exact literal "Ask TA" land in status NEEDS_INVESTIGATION with dinas_target still null — this
// is a queue only role TAB can see/act on, deliberately a NEW route (not routes/confirmation.js)
// because the action here is "assign the real dinas_target" (an investigation outcome), not
// Confirm/Decline — even though the underlying mechanics borrow reassignmentRules' target
// validation, same as routes/reassignment.js does.
router.use(requireUser, requireRole('TAB'));

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
    await client.query('COMMIT');
    res.json({ ok: true, dinas_target: newTargetUpper });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
