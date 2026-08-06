// REQ-RDT-SAP-14 (REVISI TOTAL 5 Agu): TAB sets a confirmation deadline PER PASANGAN
// (dinas_inisiasi x dinas_target) x periode, instead of one global rule. Mounted at
// /api/period-deadlines in index.js. TAB-only throughout, same gating as the rest of
// exportBatches.js/investigation.js — setting a deadline that shifts a pair's effective repost
// period is TAB's call.
//
// See rules/periodEffective.js for how these rows actually get consumed (routes/exportBatches.js's
// GET /history) — this file is just CRUD for the deadline table itself.

const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { buildValidCodeMap } = require('../rules/reassignmentRules');

const router = express.Router();

router.use(requireUser, requireRole('TAB'));

const PERIODE_RE = /^\d{4}-\d{2}$/;
// "not yet resolved" — same constant routes/exportBatches.js defines for its own readiness gate.
// Used by POST /bulk below to decide which pasangan actually count as "aktif" for a periode.
const BLOCKING_STATUSES = ['PENDING', 'DECLINED', 'NEEDS_REVIEW'];

// Shared by POST / and POST /bulk — both take { periode, deadline_at }, just with (POST /) or
// without (POST /bulk) a specific pasangan attached. Returns { ok: true, deadlineAt } or
// { ok: false, error } so both callers can respond identically on a validation failure.
function validatePeriodAndDeadline({ periode, deadline_at: deadlineAtRaw }) {
  if (!periode || !PERIODE_RE.test(periode)) return { ok: false, error: "periode must be 'YYYY-MM'" };
  const deadlineAt = deadlineAtRaw && new Date(deadlineAtRaw);
  if (!deadlineAt || isNaN(deadlineAt.getTime())) return { ok: false, error: 'deadline_at must be a valid date/time' };
  return { ok: true, deadlineAt };
}

// GET /api/period-deadlines?dinas_inisiasi=&dinas_target= — list existing deadlines, optionally
// scoped to one pasangan (both params together) for the management panel's "existing deadlines
// for this pair" list. Neither param -> every deadline TAB has ever set, for a full overview.
router.get('/', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget } = req.query;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const whereParts = [];
    const params = [];
    if (dinasInisiasi) { whereParts.push(`dinas_inisiasi = $${params.length + 1}`); params.push(dinasInisiasi); }
    if (dinasTarget) { whereParts.push(`dinas_target = $${params.length + 1}`); params.push(dinasTarget); }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT * FROM rdt.period_deadlines ${where} ORDER BY periode DESC, dinas_inisiasi, dinas_target`,
      params
    );
    res.json({ ok: true, deadlines: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/period-deadlines — body { dinas_inisiasi, dinas_target, periode, deadline_at }. Per-
// PASANGAN OVERRIDE — sets/updates the deadline for exactly one pasangan+periode. For the normal
// "one deadline, applies to every pasangan in this periode" workflow, use POST /bulk below.
//
// Upsert (ON CONFLICT on the pasangan+periode UNIQUE constraint) -- setting again for the same
// triple UPDATES the existing deadline rather than erroring or creating a duplicate. Since
// periode_efektif is now a SNAPSHOT taken once at the dinas target's Confirm/Reject moment (see
// rules/periodEffective.js / routes/confirmation.js's snapshotPeriodeEfektif — the earlier
// "computed live" design was overturned, project owner confirmed 5 Agu malam), changing a
// deadline here only affects confirm/reject actions that happen AFTER the change — it never
// rewrites an already-snapshotted pasangan.
router.post('/', express.json(), async (req, res) => {
  const { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget } = req.body || {};
  if (!dinasInisiasi || !dinasTarget) return res.status(400).json({ ok: false, error: 'dinas_inisiasi and dinas_target are required' });
  const validation = validatePeriodAndDeadline(req.body || {});
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });
  const { deadlineAt } = validation;
  const periode = req.body.periode;

  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = buildValidCodeMap(validRes.rows);
    const matchedInisiasi = validCodes.get(String(dinasInisiasi).toUpperCase());
    const matchedTarget = validCodes.get(String(dinasTarget).toUpperCase());
    if (!matchedInisiasi) return res.status(400).json({ ok: false, error: `dinas_inisiasi '${dinasInisiasi}' is not a known active dinas` });
    if (!matchedTarget) return res.status(400).json({ ok: false, error: `dinas_target '${dinasTarget}' is not a known active dinas` });

    const r = await client.query(
      `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dinas_inisiasi, dinas_target, periode)
       DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
       RETURNING *`,
      [matchedInisiasi, matchedTarget, periode, deadlineAt.toISOString(), req.rdtUser.id]
    );
    res.json({ ok: true, deadline: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/period-deadlines/bulk — body { periode, deadline_at }. NO dinas_inisiasi/dinas_target
// — this is the actual real-world workflow (confirmed 5 Agu malam, superseding the earlier
// per-pasangan-only assumption): TAB sets ONE deadline that applies to EVERY pasangan currently
// "aktif" (has a non-terminal transaction — same BLOCKING_STATUSES exportBatches.js already uses
// for its own readiness gate) in that periode at once. Per-pasangan override (POST / above) stays
// available afterward for exceptions — same table, same UNIQUE constraint, a later single-
// pasangan POST / just overwrites whatever the bulk call set for that one pasangan.
//
// Deliberately scoped to ACTIVE pasangan only: periode_efektif is a snapshot written only at a
// FUTURE Confirm/Reject (see POST / comment above) — a pasangan with no non-terminal transactions
// left has no future action to consume a deadline, so including it would just create a dead-
// letter row that's never read.
router.post('/bulk', express.json(), async (req, res) => {
  const validation = validatePeriodAndDeadline(req.body || {});
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });
  const { deadlineAt } = validation;
  const periode = req.body.periode;

  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    // $2::timestamptz explicit cast — without it, Postgres can't infer the bind parameter's type
    // from this SELECT-list position (unlike a plain INSERT...VALUES) and rejects it as text vs
    // the deadline_at column's timestamptz type.
    const r = await client.query(
      `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
       SELECT DISTINCT t.dinas_inisiasi, t.dinas_target, $1, $2::timestamptz, $3
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.status_konfirmasi = ANY($4)
       ON CONFLICT (dinas_inisiasi, dinas_target, periode)
       DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
       RETURNING *`,
      [periode, deadlineAt.toISOString(), req.rdtUser.id, BLOCKING_STATUSES]
    );
    res.json({ ok: true, periode, deadline_at: deadlineAt.toISOString(), deadlines: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
