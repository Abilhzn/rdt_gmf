// TAB sets a confirmation deadline PER PASANGAN (dinas_inisiasi x dinas_target) x periode,
// instead of one global rule. Mounted at /api/period-deadlines in index.js. TAB-only throughout
// (except GET /current-reminder below — see its own comment) — setting a deadline that shifts a
// pair's effective repost period is TAB's call.
//
// See rules/periodEffective.js for how these rows actually get consumed (routes/exportBatches.js's
// GET /history) — this file is just CRUD for the deadline table itself.

const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { buildValidCodeMap } = require('../rules/reassignmentRules');
const { currentAutoPeriode } = require('../rules/periodEffective');
const { logRollbackAudit } = require('../logger');

const router = express.Router();

// The deadline TAB sets must show as a reminder on EVERY dinas's repost pages, not just TAB's
// own — so this one route is requireUser only, registered before the requireRole('TAB') gate
// below applies to the rest of the router. Returns the periode-wide default deadline for the
// CURRENT auto-periode — deliberately not per-pasangan-specific: a banner reminder doesn't need
// that precision, and every non-TAB caller here is a PIC who doesn't know their own pairing set upfront.
router.get('/current-reminder', requireUser, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const periode = currentAutoPeriode();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query('SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode = $1', [periode]);
    res.json({ ok: true, periode, deadline_at: r.rows[0]?.deadline_at || null });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

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
// periode_efektif is a SNAPSHOT taken once at the dinas target's Confirm/Reject moment (see
// rules/periodEffective.js / confirmation.js's snapshotPeriodeEfektif), changing a deadline here
// only affects confirm/reject actions that happen AFTER the change — it never rewrites an
// already-snapshotted pasangan.
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

// GET /api/period-deadlines/default — every periode-wide default TAB has ever set, for the
// "Setting Deadline" page's own overview list — separate shape from GET / above (no
// dinas_inisiasi/dinas_target, just periode).
router.get('/default', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query('SELECT * FROM rdt.period_default_deadlines ORDER BY periode DESC');
    res.json({ ok: true, deadlines: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/period-deadlines/default — body { periode, deadline_at }. Sets a default for the
// periode ITSELF, before any dinas has even uploaded for it. Consumed by confirmation.js's
// snapshotPeriodeEfektif as the fallback when no per-pasangan override exists yet (see
// rules/periodEffective.js's pickDeadline) — a pair that shows up for this periode later
// automatically "inherits" this deadline.
//
// Also sweeps the same deadline onto pasangan that ALREADY have a non-terminal transaction in
// this periode, in the same transaction as the default upsert — no partial-success state where
// the default lands but the sweep doesn't (or vice versa).
router.post('/default', express.json(), async (req, res) => {
  const validation = validatePeriodAndDeadline(req.body || {});
  if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });
  const { deadlineAt } = validation;
  const periode = req.body.periode;
  const userId = req.rdtUser.id;

  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    try {
      const defaultRes = await client.query(
        `INSERT INTO rdt.period_default_deadlines (periode, deadline_at, set_by_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (periode)
         DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
         RETURNING *`,
        [periode, deadlineAt.toISOString(), userId]
      );

      // Sweep onto pasangan that ALREADY have a non-terminal transaction in this periode.
      // $2::timestamptz explicit cast — without it, Postgres can't infer the bind parameter's
      // type from this SELECT-list position and rejects it as text vs deadline_at's timestamptz type.
      const sweptRes = await client.query(
        `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
         SELECT DISTINCT t.dinas_inisiasi, t.dinas_target, $1, $2::timestamptz, $3
         FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
         WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.status_konfirmasi = ANY($4)
         ON CONFLICT (dinas_inisiasi, dinas_target, periode)
         DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
         RETURNING *`,
        [periode, deadlineAt.toISOString(), userId, BLOCKING_STATUSES]
      );

      await client.query('COMMIT');
      res.json({ ok: true, deadline: defaultRes.rows[0], swept: sweptRes.rows });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) {}
      const category = await logRollbackAudit(client, { userId, req, err, route: req.originalUrl });
      res.status(500).json({ ok: false, error: String(err.message || err), error_category: category });
    }
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// DELETE /api/period-deadlines/default/:periode — a default deadline can be removed, but ONLY
// while its deadline_at is still in the future — once it's passed, deleting it would rewrite
// history (pasangan that already snapshotted their periode_efektif stay snapshotted regardless,
// but leaving the row in place keeps the audit trail honest about what was in effect).
router.delete('/default/:periode', async (req, res) => {
  const { periode } = req.params;
  if (!PERIODE_RE.test(periode)) return res.status(400).json({ ok: false, error: "periode must be 'YYYY-MM'" });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const existing = await client.query('SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode = $1', [periode]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: `no default deadline set for periode ${periode}` });
    if (new Date(existing.rows[0].deadline_at).getTime() <= Date.now()) {
      return res.status(400).json({ ok: false, error: `deadline periode ${periode} sudah lewat — tidak bisa dihapus, cuma bisa dihapus sebelum waktunya` });
    }
    await client.query('DELETE FROM rdt.period_default_deadlines WHERE periode = $1', [periode]);
    res.json({ ok: true, periode });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// Scoped to un-batched pasangan only (export_batch_id IS NULL) — a pasangan already
// reposted/archived to Riwayat Repost can never appear here, keeping this strictly pre-export and
// consistent with the non-retroactive periode_efektif snapshot rule.
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

// GET /api/period-deadlines/overdue?periode=YYYY-MM — pasangan that are 100% confirmed for this
// periode but whose confirm/decline happened AFTER the deadline (periode_efektif already
// shifted), and are still un-batched. Informational only — there is no un-stick/override action;
// the cap is permanent, so this list never hides an overdue pair once TAB moves on.
router.get('/overdue', async (req, res) => {
  const periode = req.query.periode;
  if (!periode || !PERIODE_RE.test(periode)) return res.status(400).json({ ok: false, error: "periode must be 'YYYY-MM'" });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const rows = await findOverduePairs(client, periode);
    res.json({
      ok: true,
      periode,
      overdue: rows.map((r) => ({ dinas_inisiasi: r.dinas_inisiasi, dinas_target: r.dinas_target, total: r.total, periode_efektif: r.periode_efektif })),
    });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// GET /api/period-deadlines/active-pairs?periode=YYYY-MM — pasangan yang MASIH punya baris belum
// resolved (PENDING/DECLINED/NEEDS_REVIEW) di periode ini, un-batched. Deliberately a SEPARATE
// query/endpoint from GET /overdue above rather than one merged query — each stays single-purpose,
// the frontend combines both arrays into one table with a status column.
router.get('/active-pairs', async (req, res) => {
  const periode = req.query.periode;
  if (!periode || !PERIODE_RE.test(periode)) return res.status(400).json({ ok: false, error: "periode must be 'YYYY-MM'" });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT t.dinas_inisiasi, t.dinas_target, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2))::int AS open_count
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.export_batch_id IS NULL
       GROUP BY t.dinas_inisiasi, t.dinas_target
       HAVING COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2)) > 0
       ORDER BY t.dinas_inisiasi, t.dinas_target`,
      [periode, BLOCKING_STATUSES]
    );
    res.json({ ok: true, periode, active: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/period-deadlines/override-reevaluate — removed. There is no action that rewrites
// periode_efektif back to un-stick an overdue pasangan — GET /overdue above is informational only.

module.exports = router;
