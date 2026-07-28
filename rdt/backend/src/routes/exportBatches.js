// REQ-RDT-SAP-01/02 — TAB-only export approval gate before SAP export.
//
// Simplified 24 Jul 2026 (project owner correction): SM_TA/GH_TA roles removed entirely — RDT
// is small enough that role TAB alone handles Repost/Confirmation/Need Approval, including
// approving a batch once every transaction is resolved. Was a tiered SM -> GH approval; now a
// single TAB approval step. See sql/migrations/003_single_tier_approval.sql for the schema side.
//
// Design notes / decisions made while implementing (documented here since these weren't
// separately confirmed with the project owner — flagged in the session summary too):
//   - The readiness gate (REQ-RDT-SAP-01) is intentionally GLOBAL, not scoped to a period:
//     the literal requirement text is `COUNT(*) WHERE status='PENDING'` with no period
//     filter, and there's no reliable period-grouping key available at transaction grain
//     (the `period` column on rdt.transactions is the raw SAP "Period" field from the Excel
//     contract, not a clean calendar-month label) — extended per Gap 3's dependency to also
//     block on DECLINED and NEEDS_REVIEW, since those are just as unresolved as PENDING.
//   - export_batches.period is treated as an admin-supplied label for the batch (e.g. for a
//     filename/record-keeping), not a transaction filter — "submit" attaches ALL currently
//     unbatched CONFIRMED/BORNE_BY_INITIATOR transactions, regardless of their raw period text.
//   - Actual SAP flat-file generation (REQ-RDT-SAP-02) is a STUB. No SAP import column
//     template exists anywhere in this repo (checked docs/ and contoh_input/) — inventing one
//     would risk silently shipping a wrong format. The state machine (DRAFT -> WAITING_APPROVAL
//     -> APPROVED -> EXPORTED) is real; the file this produces is a clearly-labeled placeholder
//     only, not something to hand to SAP.

const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireUser);

async function withTransaction(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return { ok: true, result };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    return { ok: false, error: err.message || String(err), httpStatus: err.httpStatus || 500 };
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

// GET /api/export-batches — list all batches (TAB-only, see file header).
router.get('/', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query('SELECT * FROM rdt.export_batches ORDER BY created_at DESC');
    res.json({ ok: true, batches: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/export-batches — body { period }. Creates a DRAFT batch (no transactions attached yet).
router.post('/', requireRole('TAB'), express.json(), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const period = req.body && req.body.period;
  if (!period || typeof period !== 'string') return res.status(400).json({ ok: false, error: 'period is required' });
  const outcome = await withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO rdt.export_batches(period, created_by_user_id, status) VALUES ($1,$2,'DRAFT') RETURNING id`,
      [period, req.rdtUser.id]
    );
    const batchId = r.rows[0].id;
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,NULL,$2,NULL,$3,$4)`,
      [req.rdtUser.id, 'EXPORT_BATCH_CREATE', 'DRAFT', JSON.stringify({ batch_id: batchId, period })]
    );
    return { batch_id: batchId };
  });
  if (!outcome.ok) return res.status(outcome.httpStatus).json({ ok: false, error: outcome.error });
  res.json({ ok: true, batch_id: outcome.result.batch_id });
});

// POST /api/export-batches/:id/submit — DRAFT -> WAITING_APPROVAL, gated on no unresolved
// transactions ("100% dan tidak ada miscommunication"), attaches all currently unbatched
// CONFIRMED/BORNE_BY_INITIATOR transactions to this batch.
router.post('/:id/submit', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const id = req.params.id;
  const outcome = await withTransaction(async (client) => {
    const q = await client.query('SELECT id, status FROM rdt.export_batches WHERE id=$1 FOR UPDATE', [id]);
    if (!q.rows.length) throw Object.assign(new Error('batch not found: ' + id), { httpStatus: 404 });
    const batch = q.rows[0];
    if (batch.status !== 'DRAFT') throw Object.assign(new Error(`batch is not DRAFT (currently ${batch.status})`), { httpStatus: 409 });

    const gate = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM rdt.transactions WHERE status_konfirmasi IN ('PENDING','DECLINED','NEEDS_REVIEW')`
    );
    const unresolvedCount = gate.rows[0].cnt;
    if (unresolvedCount > 0) {
      throw Object.assign(new Error(`${unresolvedCount} transaksi masih PENDING/DECLINED/NEEDS_REVIEW — belum bisa submit ke approval`), { httpStatus: 400 });
    }

    const attachRes = await client.query(
      `UPDATE rdt.transactions SET export_batch_id=$1
       WHERE status_konfirmasi IN ('CONFIRMED','BORNE_BY_INITIATOR') AND export_batch_id IS NULL
       RETURNING id`,
      [id]
    );
    await client.query(`UPDATE rdt.export_batches SET status='WAITING_APPROVAL' WHERE id=$1`, [id]);
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,NULL,$2,$3,$4,$5)`,
      [req.rdtUser.id, 'EXPORT_BATCH_SUBMIT', 'DRAFT', 'WAITING_APPROVAL', JSON.stringify({ batch_id: id, attached_count: attachRes.rowCount })]
    );
    return { attached_count: attachRes.rowCount };
  });
  if (!outcome.ok) return res.status(outcome.httpStatus).json({ ok: false, error: outcome.error });
  res.json({ ok: true, attached_count: outcome.result.attached_count });
});

// POST /api/export-batches/:id/approve — WAITING_APPROVAL -> APPROVED. Replaces the old
// sm-approve/gh-approve pair with a single TAB approval step.
router.post('/:id/approve', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const id = req.params.id;
  const outcome = await withTransaction(async (client) => {
    const q = await client.query('SELECT id, status FROM rdt.export_batches WHERE id=$1 FOR UPDATE', [id]);
    if (!q.rows.length) throw Object.assign(new Error('batch not found: ' + id), { httpStatus: 404 });
    if (q.rows[0].status !== 'WAITING_APPROVAL') throw Object.assign(new Error(`batch is not WAITING_APPROVAL (currently ${q.rows[0].status})`), { httpStatus: 409 });
    await client.query(
      `UPDATE rdt.export_batches SET status='APPROVED', approved_by_user_id=$1, approved_at=now() WHERE id=$2`,
      [req.rdtUser.id, id]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,NULL,$2,$3,$4,$5)`,
      [req.rdtUser.id, 'EXPORT_BATCH_APPROVE', 'WAITING_APPROVAL', 'APPROVED', JSON.stringify({ batch_id: id })]
    );
    return {};
  });
  if (!outcome.ok) return res.status(outcome.httpStatus).json({ ok: false, error: outcome.error });
  res.json({ ok: true });
});

// POST /api/export-batches/:id/export — APPROVED -> EXPORTED.
// STUB ONLY: does not produce a real SAP-importable file (see file header comment).
router.post('/:id/export', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const id = req.params.id;
  const outcome = await withTransaction(async (client) => {
    const q = await client.query('SELECT id, status, period FROM rdt.export_batches WHERE id=$1 FOR UPDATE', [id]);
    if (!q.rows.length) throw Object.assign(new Error('batch not found: ' + id), { httpStatus: 404 });
    if (q.rows[0].status !== 'APPROVED') throw Object.assign(new Error(`batch is not APPROVED (currently ${q.rows[0].status})`), { httpStatus: 409 });
    const filename = `STUB_export_batch${id}_${q.rows[0].period}_${Date.now()}.csv`;
    await client.query(
      `UPDATE rdt.export_batches SET status='EXPORTED', exported_at=now(), export_filename=$1 WHERE id=$2`,
      [filename, id]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,NULL,$2,$3,$4,$5)`,
      [req.rdtUser.id, 'EXPORT_SAP', 'APPROVED', 'EXPORTED', JSON.stringify({ batch_id: id, filename, stub: true, note: 'placeholder only — no real SAP import column template available yet' })]
    );
    return { filename };
  });
  if (!outcome.ok) return res.status(outcome.httpStatus).json({ ok: false, error: outcome.error });
  res.json({ ok: true, filename: outcome.result.filename, stub: true, warning: 'File generation is a placeholder only — a real SAP import column template has not been provided yet.' });
});

module.exports = router;
