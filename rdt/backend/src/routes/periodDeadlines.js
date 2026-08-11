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
const { computeEffectivePeriod, addMonths } = require('../rules/periodEffective');

const router = express.Router();

router.use(requireUser, requireRole('TAB'));

const PERIODE_RE = /^\d{4}-\d{2}$/;
// "not yet resolved" — same constant routes/exportBatches.js defines for its own readiness gate.
// Used by POST /bulk below to decide which pasangan actually count as "aktif" for a periode.
const BLOCKING_STATUSES = ['PENDING', 'DECLINED', 'NEEDS_REVIEW'];
// "fully resolved" — same constant routes/exportBatches.js calls ATTACHABLE_STATUSES for its own
// readiness gate (duplicated here rather than exported/imported, matching how BLOCKING_STATUSES
// above is already duplicated rather than shared). Used by GET /overdue and POST
// /override-reevaluate below to define "100% confirmed".
const ATTACHABLE_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR'];

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

// Used by GET /overdue below. NOT reused by POST /override-reevaluate's own re-check — that
// route needs row-level `SELECT ... FOR UPDATE` locks, and Postgres doesn't allow FOR UPDATE
// together with GROUP BY/aggregates, so it re-verifies the same "100% confirmed + overdue" shape
// via its own row-level query instead (see there). Scoped to un-batched pasangan only
// (export_batch_id IS NULL) — per project owner decision (7 Agu planning): a pasangan already
// reposted/archived to Riwayat Repost can never appear here, keeping this strictly pre-export and
// consistent with the non-retroactive periode_efektif snapshot rule (see routes/confirmation.js's
// snapshotPeriodeEfektif).
async function findOverduePairs(client, periode) {
  const r = await client.query(
    `SELECT t.dinas_inisiasi, t.dinas_target,
            COUNT(*)::int AS total,
            MAX(t.periode_efektif) AS periode_efektif
     FROM rdt.transactions t
     JOIN rdt.uploads u ON u.id = t.upload_id
     WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.export_batch_id IS NULL
     GROUP BY t.dinas_inisiasi, t.dinas_target
     HAVING COUNT(*) = COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2))
        AND MAX(t.periode_efektif) IS NOT NULL AND MAX(t.periode_efektif) <> $1
     ORDER BY t.dinas_inisiasi, t.dinas_target`,
    [periode, ATTACHABLE_STATUSES]
  );
  return r.rows;
}

// "TAB has moved on to Setting Deadline for periode N+1" — DIPERJELAS 7 Agu's reset rule: once
// TRUE, the Override Deadline list for `periode` must come back empty regardless of what
// findOverduePairs above would otherwise find, and POST /override-reevaluate must reject. A
// GLOBAL check (ANY pasangan at N+1), not scoped to the one pasangan being overridden — matches
// the SRS framing that the closing event is "TAB set deadline for N+1" as a whole (typically via
// POST /bulk), not "this specific pasangan already has an N+1 deadline".
async function periodeNextAlreadySet(client, periode) {
  const r = await client.query('SELECT 1 FROM rdt.period_deadlines WHERE periode = $1 LIMIT 1', [addMonths(periode, 1)]);
  return r.rows.length > 0;
}

// GET /api/period-deadlines/overdue?periode=YYYY-MM — DIPERJELAS 7 Agu: "Override Deadline"'s
// list — pasangan that are 100% confirmed for this periode but whose confirm/decline happened
// AFTER the deadline (periode_efektif already shifted), and are still un-batched. TAB picks one
// from this list and gives it a new deadline via POST /override-reevaluate below, which
// re-evaluates (not just records) that pasangan's periode_efektif.
router.get('/overdue', async (req, res) => {
  const periode = req.query.periode;
  if (!periode || !PERIODE_RE.test(periode)) return res.status(400).json({ ok: false, error: "periode must be 'YYYY-MM'" });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    if (await periodeNextAlreadySet(client, periode)) {
      return res.json({ ok: true, periode, overdue: [] });
    }
    const rows = await findOverduePairs(client, periode);
    res.json({
      ok: true,
      periode,
      overdue: rows.map((r) => ({ dinas_inisiasi: r.dinas_inisiasi, dinas_target: r.dinas_target, total: r.total, periode_efektif: r.periode_efektif })),
    });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/period-deadlines/override-reevaluate — DIPERJELAS 7 Agu. Body: { dinas_inisiasi,
// dinas_target, periode, deadline_at }. The one deliberate exception to periode_efektif being a
// permanent snapshot (routes/confirmation.js's snapshotPeriodeEfektif) — a conscious, TAB-
// initiated, single-pasangan re-open, always on the strength of an out-of-band team agreement
// (same shape as REQ-RDT-LEDGER-10's Investigation assign flow), never an automatic recompute.
// Reviewed with senior-advisor (7 Agu) given the sensitivity: everything re-checked INSIDE the
// transaction after locking (never trusts what GET /overdue showed the frontend a moment
// earlier — another TAB action, e.g. Setting Deadline for periode N+1, could race in between),
// row locks acquired in a stable `ORDER BY id ASC` to bound deadlock risk on a multi-row update,
// and one audit_log row PER TRANSACTION (matching investigation.js's assign-all convention, not
// a single summary row) so the old periode_efektif per row survives as a permanent record.
router.post('/override-reevaluate', express.json(), async (req, res) => {
  const { dinas_inisiasi: dinasInisiasiRaw, dinas_target: dinasTargetRaw } = req.body || {};
  if (!dinasInisiasiRaw || !dinasTargetRaw) return res.status(400).json({ ok: false, error: 'dinas_inisiasi and dinas_target are required' });
  const validation = validatePeriodAndDeadline(req.body || {});
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });
  const { deadlineAt } = validation;
  const periode = req.body.periode;
  const userId = req.rdtUser.id;

  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = buildValidCodeMap(validRes.rows);
    const dinasInisiasi = validCodes.get(String(dinasInisiasiRaw).toUpperCase());
    const dinasTarget = validCodes.get(String(dinasTargetRaw).toUpperCase());
    if (!dinasInisiasi) return res.status(400).json({ ok: false, error: `dinas_inisiasi '${dinasInisiasiRaw}' is not a known active dinas` });
    if (!dinasTarget) return res.status(400).json({ ok: false, error: `dinas_target '${dinasTargetRaw}' is not a known active dinas` });

    await client.query('BEGIN');
    try {
      if (await periodeNextAlreadySet(client, periode)) {
        throw Object.assign(new Error(`periode berikutnya sudah punya deadline — pasangan overdue di periode ${periode} sudah permanen masuk periode berikutnya, tidak bisa di-override lagi`), { httpStatus: 400 });
      }
      // Lock every currently un-batched row for this pasangan+periode, ANY status — need to see
      // BLOCKING rows too (not just ATTACHABLE) to correctly reject a pasangan that ISN'T actually
      // 100% resolved yet, not just to read the ATTACHABLE ones.
      const lockRes = await client.query(
        `SELECT t.id, t.status_konfirmasi, t.periode_efektif
         FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
         WHERE t.dinas_inisiasi = $1 AND t.dinas_target = $2 AND u.period = $3 AND t.export_batch_id IS NULL
         ORDER BY t.id ASC FOR UPDATE`,
        [dinasInisiasi, dinasTarget, periode]
      );
      const rows = lockRes.rows;
      if (!rows.length) throw Object.assign(new Error(`tidak ada transaksi un-batched untuk ${dinasInisiasi}→${dinasTarget} periode ${periode}`), { httpStatus: 400 });
      const notAttachable = rows.filter((r) => !ATTACHABLE_STATUSES.includes(r.status_konfirmasi));
      if (notAttachable.length) {
        throw Object.assign(new Error(`${notAttachable.length} transaksi ${dinasInisiasi}→${dinasTarget} periode ${periode} belum 100% confirmed (masih PENDING/DECLINED/NEEDS_REVIEW) — belum bisa di-override`), { httpStatus: 400 });
      }
      const maxPeriodeEfektif = rows.reduce((max, r) => (!max || (r.periode_efektif && r.periode_efektif > max) ? r.periode_efektif : max), null);
      if (!maxPeriodeEfektif || maxPeriodeEfektif === periode) {
        throw Object.assign(new Error(`pasangan ${dinasInisiasi}→${dinasTarget} periode ${periode} tidak/tidak lagi overdue — tidak ada yang perlu di-override`), { httpStatus: 400 });
      }

      // Upsert the new deadline — same statement POST / above uses.
      await client.query(
        `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (dinas_inisiasi, dinas_target, periode)
         DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()`,
        [dinasInisiasi, dinasTarget, periode, deadlineAt.toISOString(), userId]
      );

      // Per-row re-evaluation — granularity confirmed load-bearing 5 Agu malam (split+redirect+
      // reconverge scenario: each row keeps its OWN confirm/decline timestamp, not one shared
      // pasangan-level value).
      const reevaluated = [];
      for (const row of rows) {
        const actionRes = await client.query(
          `SELECT MAX(created_at) AS acted_at FROM rdt.audit_log WHERE transaction_id = $1 AND action IN ('CONFIRM','DECLINE')`,
          [row.id]
        );
        const latestTargetActionAt = actionRes.rows[0].acted_at;
        const { periodeEfektif: newPeriodeEfektif } = computeEffectivePeriod({
          declaredPeriod: periode,
          deadlineAt: deadlineAt.toISOString(),
          latestTargetActionAt,
        });
        const oldPeriodeEfektif = row.periode_efektif;
        await client.query('UPDATE rdt.transactions SET periode_efektif = $1 WHERE id = $2', [newPeriodeEfektif, row.id]);
        await client.query(
          `INSERT INTO rdt.audit_log(user_id, transaction_id, action, status_before, status_after, detail)
           VALUES ($1, $2, 'PERIODE_EFEKTIF_OVERRIDE', $3, $3, $4)`,
          [
            userId,
            row.id,
            row.status_konfirmasi,
            JSON.stringify({
              dinas_inisiasi: dinasInisiasi,
              dinas_target: dinasTarget,
              periode,
              old_periode_efektif: oldPeriodeEfektif,
              new_periode_efektif: newPeriodeEfektif,
              new_deadline_at: deadlineAt.toISOString(),
            }),
          ]
        );
        reevaluated.push({ id: row.id, old_periode_efektif: oldPeriodeEfektif, new_periode_efektif: newPeriodeEfektif });
      }

      await client.query('COMMIT');
      res.json({ ok: true, dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, periode, deadline_at: deadlineAt.toISOString(), reevaluated });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) {}
      res.status(err.httpStatus || 500).json({ ok: false, error: err.message || String(err) });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

module.exports = router;
