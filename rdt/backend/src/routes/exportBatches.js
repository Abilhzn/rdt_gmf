// Need Approval per PASANGAN (dinas_inisiasi, dinas_target). The unit of approval is exactly one
// pair, processed independently the moment IT is ready — other pairs from the same initiator
// never block or get blocked by it.
//
// Design:
//   - WAITING is a COMPUTED state, never stored. No rdt.export_batches row exists until TAB
//     actually confirms that specific pair — every row that exists IS a confirmed entry (no
//     status column).
//   - No EXPORTED state either. Download is a stateless, repeatable action, available even BEFORE
//     a batch/confirm exists — see GET /export-pair below.
//   - "Blocking" statuses for readiness (PENDING/DECLINED/NEEDS_REVIEW) and "attachable" statuses
//     (CONFIRMED/BORNE_BY_INITIATOR) — EXCLUDED/INVALID rows are deliberately excluded from both sets.
//
// closing_description fans out as a comment + notification. One batch = exactly one pair, so
// there's only ever one target dinas to notify per confirm — a single comment + notification
// block. Comment anchors to the pair's most-recently-attached transaction, same convention
// dashboard.js's own top-level comments use — same thread each target PIC already reads, no
// frontend work needed for PICs to see it. Recipients are resolved directly from the directory by
// dinas match rather than round-tripping through @mention parsing, since the recipient dinas here
// is already known deterministically.
//
// Download no longer waits for TAB to click Confirm at all — it's available the instant a pair is
// "ready" (GET /export-pair). POST /confirm itself ALSO takes the first subdoc_number in the same
// call ("posting to SAP happened, here's the resulting number" IS what Confirm means now) instead
// of that being a separate POST /:batchId/subdocs call afterward. See POST /confirm's own header
// comment for the full consequence chain.

const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { CONTRACT_FIELDS } = require('../parser/excelParser');
const { loadDirectory } = require('../dataUserClient');
const { deriveStateLabel } = require('../rules/stateLabel');
const { resolveMentionedUserIds, filterMentionsToPair } = require('../rules/mentionRules');
const { validateFreeText } = require('../rules/textValidation');
const { logRollbackAudit } = require('../logger');
// computeEffectivePeriod is called at SNAPSHOT time in routes/confirmation.js, not here —
// GET /history below just reads the already-locked rdt.transactions.periode_efektif column.

const router = express.Router();
// requireRole('TAB') applied per-route below, NOT at the router level — GET /history is
// deliberately open to any authenticated user: the initiating dinas's own PIC can see their own
// repost/subdoc status there, auto-scoped server-side, while every other route here stays TAB-only.
router.use(requireUser);

const BLOCKING_STATUSES = ['PENDING', 'DECLINED', 'NEEDS_REVIEW'];
const ATTACHABLE_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR'];

// req/userId are only used for the rollback-logging call below — callers that don't have a
// userId yet (none currently) can pass null, logRollbackAudit handles it.
async function withTransaction(req, userId, fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return { ok: true, result };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const category = await logRollbackAudit(client, { userId, req, err, route: req.originalUrl });
    return { ok: false, error: err.message || String(err), httpStatus: err.httpStatus || 500, errorCategory: category };
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

// GET /api/export-batches/waiting — one entry PER PASANGAN (dinas_inisiasi, dinas_target) whose
// currently-unbatched rows are all resolved — no PENDING/DECLINED/NEEDS_REVIEW left for THAT PAIR
// specifically. Other pairs from the same dinas_inisiasi never block or get blocked by this one.
router.get('/waiting', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    // Overdue pairs stay in the list with an `overdue` flag (permanent/sticky — see isOverdue
    // below, it's based on periode_efektif ever having shifted, which snapshotPeriodeEfektif
    // never un-writes). Same declared-vs-effective tracking dashboard.js's
    // buildChainAwareProgress/buildNeedToConfirmProgress use.
    const r = await client.query(
      `SELECT t.dinas_inisiasi, t.dinas_target, t.status_konfirmasi, u.period AS declared_period, t.periode_efektif
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.export_batch_id IS NULL AND t.dinas_target IS NOT NULL
         AND t.status_konfirmasi = ANY($1)`,
      [[...BLOCKING_STATUSES, ...ATTACHABLE_STATUSES]]
    );
    const byPair = {};
    for (const t of r.rows) {
      const key = `${t.dinas_inisiasi} ${t.dinas_target}`;
      if (!byPair[key]) byPair[key] = { dinas_inisiasi: t.dinas_inisiasi, dinas_target: t.dinas_target, blocked: false, total: 0, periodCounts: {}, maxPeriodeEfektif: null };
      if (BLOCKING_STATUSES.includes(t.status_konfirmasi)) byPair[key].blocked = true;
      else byPair[key].total += 1;
      if (t.declared_period) byPair[key].periodCounts[t.declared_period] = (byPair[key].periodCounts[t.declared_period] || 0) + 1;
      if (t.periode_efektif && (!byPair[key].maxPeriodeEfektif || t.periode_efektif > byPair[key].maxPeriodeEfektif)) byPair[key].maxPeriodeEfektif = t.periode_efektif;
    }
    // Most-common declared period wins (same pattern as dashboard.js / GET /history below),
    // overdue = MAX(periode_efektif) shifted away from it. Sticky by construction: periode_efektif
    // is a one-way snapshot (confirmation.js's snapshotPeriodeEfektif), so once it has shifted for
    // any row in this pair, this flag stays true for that pair regardless of new deadlines set later.
    const isOverdue = (p) => {
      let declaredPeriod = null;
      let bestCount = 0;
      for (const [period, c] of Object.entries(p.periodCounts)) {
        if (c > bestCount) { declaredPeriod = period; bestCount = c; }
      }
      return !!(declaredPeriod && p.maxPeriodeEfektif && p.maxPeriodeEfektif !== declaredPeriod);
    };
    // Every entry here is, by construction, fully resolved with no export_batches row yet -- the
    // exact "Waiting to repost" state, constant across all rows in this list. Overdue pairs are
    // not filtered out — they stay in "Wait to Repost" with `overdue: true` so TAB can still act on them.
    const waiting = Object.values(byPair)
      .filter((p) => !p.blocked && p.total > 0)
      .sort((a, b) => (a.dinas_inisiasi + a.dinas_target).localeCompare(b.dinas_inisiasi + b.dinas_target))
      .map((p) => ({ dinas_inisiasi: p.dinas_inisiasi, dinas_target: p.dinas_target, total: p.total, overdue: isOverdue(p), state_label: deriveStateLabel({ pendingCount: 0, targetDinas: p.dinas_target }) }));
    res.json({ ok: true, waiting });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// GET /api/export-batches/confirmed — removed. Used to list batches confirmed but not yet given a
// subdoc; under the merged POST /confirm below (creates a batch WITH its first subdoc
// atomically), that intermediate state can no longer occur. See POST /confirm's header comment,
// and GET /history for where every confirmed batch now shows up immediately.

// GET /api/export-batches/:batchId/lines — every transaction attached to this batch, each
// annotated with which subdoc (if any) already covers it — lets TAB see/pick which rows go in a
// new subdoc before calling POST below, instead of the subdoc list being a bare set of numbers
// with no line-item context.
router.get('/:batchId/lines', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { batchId } = req.params;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT t.id, t.account, t.nominal, t.remark, t.ref_doc, t.subdoc_id, s.subdoc_number
       FROM rdt.transactions t
       LEFT JOIN rdt.export_subdocs s ON s.id = t.subdoc_id
       WHERE t.export_batch_id = $1
       ORDER BY t.id`,
      [batchId]
    );
    res.json({ ok: true, lines: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/export-batches/:batchId/subdocs — body: { subdoc_number, transaction_ids? }. Adds one
// SAP reference number to a confirmed batch — can be called more than once per batch (one pair
// may split into several subdocs when it exceeds SAP's ~300 line item cap). transaction_ids is
// optional: defaults to every transaction in this batch not yet covered by an earlier subdoc (the
// common case — one subdoc for the whole pair). When given, every id must belong to this batch
// and not already be covered by another subdoc — otherwise TAB could silently double-count a line
// across two subdoc numbers. Every batch already gets its first subdoc atomically at POST
// /confirm time — this route is now reached only for the overflow case (a pair over SAP's
// ~300-line cap needing more than one subdoc), called from the Riwayat Repost TAB page's
// "+ Tambah subdoc" control.
router.post('/:batchId/subdocs', requireRole('TAB'), express.json(), async (req, res) => {
  const { batchId } = req.params;
  const subdocNumber = req.body && String(req.body.subdoc_number || '').trim();
  const requestedIds = req.body && Array.isArray(req.body.transaction_ids) ? req.body.transaction_ids : null;
  const userId = req.rdtUser.id;
  if (!subdocNumber) return res.status(400).json({ ok: false, error: 'subdoc_number is required' });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const batchRes = await client.query('SELECT id, dinas_inisiasi, dinas_target FROM rdt.export_batches WHERE id=$1', [batchId]);
    if (!batchRes.rows.length) throw new Error('batch not found: ' + batchId);

    const unassignedRes = await client.query(
      'SELECT id FROM rdt.transactions WHERE export_batch_id=$1 AND subdoc_id IS NULL',
      [batchId]
    );
    const unassignedIds = new Set(unassignedRes.rows.map((r) => Number(r.id)));
    let targetIds;
    if (requestedIds) {
      targetIds = requestedIds.map(Number);
      const invalid = targetIds.filter((id) => !unassignedIds.has(id));
      if (invalid.length) {
        throw new Error(`transaction_ids not eligible (not in this batch, or already covered by another subdoc): ${invalid.join(', ')}`);
      }
    } else {
      targetIds = Array.from(unassignedIds);
    }
    if (!targetIds.length) {
      throw new Error('no unassigned transactions to cover — every line in this batch already has a subdoc');
    }

    const insertRes = await client.query(
      'INSERT INTO rdt.export_subdocs (batch_id, subdoc_number) VALUES ($1, $2) RETURNING id, subdoc_number, created_at',
      [batchId, subdocNumber]
    );
    const subdocId = insertRes.rows[0].id;
    await client.query('UPDATE rdt.transactions SET subdoc_id=$1 WHERE id = ANY($2)', [subdocId, targetIds]);
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [userId, 'SUBDOC_ADDED', 'CONFIRMED', 'CONFIRMED', JSON.stringify({ batch_id: Number(batchId), dinas_inisiasi: batchRes.rows[0].dinas_inisiasi, dinas_target: batchRes.rows[0].dinas_target, subdoc_number: subdocNumber, transaction_ids: targetIds }), req.ip]
    );
    await client.query('COMMIT');
    res.json({ ok: true, subdoc: { ...insertRes.rows[0], transaction_ids: targetIds } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    const category = await logRollbackAudit(client, { userId, req, err, route: req.originalUrl });
    res.status(400).json({ ok: false, error: String(err.message || err), error_category: category });
  } finally { try { await client.end(); } catch (e) {} }
});

// GET /api/export-batches/history — "Riwayat Repost TAB/Dinas". Every batch that HAS at least
// one subdoc, optionally filtered to a period. This is the in-app substitute for a deferred email
// notification — PICs still get the existing in-app notification + comment from POST /confirm
// itself, this page is a browsable log on top, not a replacement.
//
// Deliberately NOT requireRole('TAB') — the dinas PENGAJU should see their own repost/subdoc
// history too, symmetric with TAB's view, using the SAME table/endpoint rather than a separate
// feature ("satu sumber data, dua sudut pandang"). TAB sees every dinas; anyone else is
// force-scoped to their own dinas_inisiasi regardless of what they ask for — there's no
// dinas_inisiasi query param to accept from a non-TAB caller.
router.get('/history', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  // Single periode ('YYYY-MM') filter, matching the same declared/effective period the frontend's
  // month-tabs group by — applied after `period`/`period_efektif` are derived below (small
  // per-dinas monthly row counts, filtering in JS here is simpler than reshaping the SQL joins for it).
  const { periode } = req.query;
  const user = req.rdtUser;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const whereParts = ['EXISTS (SELECT 1 FROM rdt.export_subdocs s WHERE s.batch_id = b.id)'];
    const params = [];
    if (user.role !== 'TAB') { whereParts.push(`b.dinas_inisiasi = $${params.length + 1}`); params.push(user.dinas); }
    const r = await client.query(
      `SELECT b.* FROM rdt.export_batches b WHERE ${whereParts.join(' AND ')} ORDER BY b.confirmed_at DESC`,
      params
    );
    const batchIds = r.rows.map((b) => b.id);
    const subdocsByBatch = {};
    if (batchIds.length) {
      // Which transaction ids each subdoc number actually covers, not just the bare number — a
      // batch split across several subdocs needs this to answer "which lines are in which subdoc"
      // from the history view, not only from the TAB-only /:batchId/lines picker.
      const subdocsRes = await client.query(
        `SELECT s.id, s.batch_id, s.subdoc_number, s.created_at,
                COALESCE(array_agg(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '{}') AS transaction_ids
         FROM rdt.export_subdocs s
         LEFT JOIN rdt.transactions t ON t.subdoc_id = s.id
         WHERE s.batch_id = ANY($1)
         GROUP BY s.id
         ORDER BY s.created_at ASC, s.id ASC`,
        [batchIds]
      );
      for (const s of subdocsRes.rows) {
        if (!subdocsByBatch[s.batch_id]) subdocsByBatch[s.batch_id] = [];
        subdocsByBatch[s.batch_id].push({ id: s.id, subdoc_number: s.subdoc_number, created_at: s.created_at, transaction_ids: s.transaction_ids });
      }
    }
    // rdt.export_batches has no period column of its own — a batch's "period" is derived from the
    // uploads its transactions came from (rdt.uploads.period, set at Repost time). A batch
    // normally draws from exactly one upload/period; if it ever legitimately spans more than one,
    // the most common period among its transactions wins — deterministic, not an arbitrary pick.
    // This is the DECLARED period (what the data is actually FOR), kept for audit/history purposes
    // even though the block below archives by a possibly different EFEKTIF period.
    const periodByBatch = {};
    if (batchIds.length) {
      const periodRes = await client.query(
        `SELECT t.export_batch_id AS batch_id, u.period, COUNT(*)::int AS c
         FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
         WHERE t.export_batch_id = ANY($1) AND u.period IS NOT NULL
         GROUP BY t.export_batch_id, u.period
         ORDER BY t.export_batch_id, c DESC, u.period DESC`,
        [batchIds]
      );
      for (const row of periodRes.rows) {
        if (!(row.batch_id in periodByBatch)) periodByBatch[row.batch_id] = row.period;
      }
    }
    // period_efektif is a SNAPSHOT, locked per-transaction the moment the dinas TARGET
    // Confirms/Declines (confirmation.js's snapshotPeriodeEfektif) — NOT recomputed here against
    // whatever rdt.period_deadlines says right now. This is what makes it non-retroactive: editing
    // a deadline later only affects confirm/reject actions that happen AFTER the edit, never
    // rewrites an already-archived pasangan's period. A batch's displayed period_efektif is the
    // MAX ("worst case") among its transactions' individually-snapshotted values — mirrors how
    // periodByBatch above aggregates, just MAX instead of mode. NULL entries (legacy rows, or rows
    // with no declared period) are skipped by MAX automatically and fall back to the declared period.
    const effectiveByBatch = {};
    if (batchIds.length) {
      const effRes = await client.query(
        `SELECT export_batch_id AS batch_id, MAX(periode_efektif) AS max_effective
         FROM rdt.transactions WHERE export_batch_id = ANY($1)
         GROUP BY export_batch_id`,
        [batchIds]
      );
      for (const row of effRes.rows) {
        effectiveByBatch[row.batch_id] = row.max_effective;
      }
    }
    const batches = r.rows.map((b) => {
      const subdocs = subdocsByBatch[b.id] || [];
      const subdocNumbers = subdocs.map((s) => s.subdoc_number);
      const period = periodByBatch[b.id] || null;
      const periodEfektif = effectiveByBatch[b.id] || period;
      const overdue = !!(period && periodEfektif && periodEfektif !== period);
      return {
        ...b,
        period,
        period_efektif: periodEfektif,
        overdue,
        subdocs,
        subdoc_numbers: subdocNumbers,
        state_label: deriveStateLabel({ pendingCount: 0, targetDinas: b.dinas_target, subdocNumbers }),
      };
    });
    // Filter by periode (declared, falling back to effective — same precedence monthGroups uses)
    // after derivation, not in the WHERE clause above — see comment on `periode` destructure.
    const filtered = periode ? batches.filter((b) => (b.period_efektif || b.period) === periode) : batches;
    res.json({ ok: true, batches: filtered });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// GET /api/export-batches/transparency/:dinasInisiasi/:dinasTarget — full detail for ONE pair's
// currently-unbatched transactions (including a row that's now BORNE_BY_INITIATOR having earlier
// been DECLINED, or one that arrived via reassignment — reassigned_from/reassign_count surface
// that history), so TAB can review before confirming that pair.
router.get('/transparency/:dinasInisiasi/:dinasTarget', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { dinasInisiasi, dinasTarget } = req.params;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    // `SELECT *` (bukan daftar kolom manual) supaya kalau kontrak 53-kolom berubah, ini otomatis
    // ikut — preview harus tampilkan SEMUA kolom yang benar-benar ikut ter-repost.
    const r = await client.query(
      `SELECT *
       FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL
         AND status_konfirmasi = ANY($3)
       ORDER BY id`,
      [dinasInisiasi, dinasTarget, [...BLOCKING_STATUSES, ...ATTACHABLE_STATUSES]]
    );
    res.json({ ok: true, dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, transactions: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/export-batches/confirm — body: { dinas_inisiasi, dinas_target, closing_description,
// subdoc_number, transaction_ids? }. subdoc_number is MANDATORY — the real-world action this
// button represents is "I already downloaded the file and posted it to SAP, here's the resulting
// subdoc number", not just a bare approval. closing_description is OPTIONAL, but the
// NOTIFICATION to the target dinas always fires either way: they may be waiting on it, so an
// unwritten note falls back to a short system-generated comment instead of skipping notification.
// One atomic transaction: re-checks readiness server-side (defensive), creates the batch, sweeps
// in every currently attachable row for this pair, THEN immediately attaches the first subdoc to
// those same rows — one form, not two steps. transaction_ids is optional (mirrors
// POST /:batchId/subdocs's own parameter) for the >300-line-item case: pass a subset if the first
// subdoc should only cover part of the pair, leaving the rest to be covered by additional calls
// to POST /:batchId/subdocs afterward — omitted, it defaults to every attached row, the common
// single-subdoc case.
//
// CONSEQUENCE: a batch can no longer exist in a "confirmed, no subdoc yet" state — it's created
// WITH its first subdoc already attached. GET /confirmed (the old "waiting for a subdoc" list)
// was removed accordingly; every batch this route creates is immediately archived into
// GET /history.
router.post('/confirm', requireRole('TAB'), express.json(), async (req, res) => {
  const dinasInisiasi = req.body && req.body.dinas_inisiasi;
  const dinasTarget = req.body && req.body.dinas_target;
  const subdocNumber = req.body && String(req.body.subdoc_number || '').trim();
  const requestedIds = req.body && Array.isArray(req.body.transaction_ids) ? req.body.transaction_ids.map(Number) : null;
  const userId = req.rdtUser.id;
  if (!dinasInisiasi) return res.status(400).json({ ok: false, error: 'dinas_inisiasi is required' });
  if (!dinasTarget) return res.status(400).json({ ok: false, error: 'dinas_target is required' });
  // closing_description is optional — TAB can confirm a repost with no closing note at all. Still
  // length-capped when it IS given.
  const closingDescriptionCheck = validateFreeText(req.body && req.body.closing_description, { fieldLabel: 'closing_description' });
  if (!closingDescriptionCheck.ok) return res.status(400).json(closingDescriptionCheck);
  const closingDescription = closingDescriptionCheck.value;
  if (!subdocNumber) return res.status(400).json({ ok: false, error: 'subdoc_number is required' });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });

  const outcome = await withTransaction(req, userId, async (client) => {
    const gate = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi = ANY($3)`,
      [dinasInisiasi, dinasTarget, BLOCKING_STATUSES]
    );
    if (gate.rows[0].cnt > 0) {
      throw Object.assign(new Error(`${gate.rows[0].cnt} transaksi ${dinasInisiasi}→${dinasTarget} masih PENDING/DECLINED/NEEDS_REVIEW — belum bisa confirm`), { httpStatus: 400 });
    }
    const batchRes = await client.query(
      `INSERT INTO rdt.export_batches(dinas_inisiasi, dinas_target, closing_description, confirmed_by_user_id, confirmed_at)
       VALUES ($1,$2,$3,$4,now()) RETURNING id`,
      [dinasInisiasi, dinasTarget, closingDescription, userId]
    );
    const batchId = batchRes.rows[0].id;
    const attachRes = await client.query(
      `UPDATE rdt.transactions SET export_batch_id=$1
       WHERE dinas_inisiasi=$2 AND dinas_target=$3 AND status_konfirmasi = ANY($4) AND export_batch_id IS NULL
       RETURNING id`,
      [batchId, dinasInisiasi, dinasTarget, ATTACHABLE_STATUSES]
    );
    if (!attachRes.rowCount) {
      throw Object.assign(new Error(`Tidak ada transaksi CONFIRMED/BORNE_BY_INITIATOR untuk ${dinasInisiasi}→${dinasTarget} — tidak ada yang bisa di-confirm`), { httpStatus: 400 });
    }

    // First subdoc, attached in the SAME transaction — see this route's header comment. Defaults
    // to every row just attached above; a caller-supplied subset must be a subset of that set
    // (same validation POST /:batchId/subdocs applies for later subdocs on this batch).
    const attachedIds = new Set(attachRes.rows.map((r) => Number(r.id)));
    let subdocTargetIds;
    if (requestedIds) {
      const invalid = requestedIds.filter((id) => !attachedIds.has(id));
      if (invalid.length) {
        throw Object.assign(new Error(`transaction_ids not eligible (not attached to this pair just now): ${invalid.join(', ')}`), { httpStatus: 400 });
      }
      subdocTargetIds = requestedIds;
    } else {
      subdocTargetIds = Array.from(attachedIds);
    }
    const subdocRes = await client.query(
      'INSERT INTO rdt.export_subdocs (batch_id, subdoc_number) VALUES ($1, $2) RETURNING id',
      [batchId, subdocNumber]
    );
    const subdocId = subdocRes.rows[0].id;
    await client.query('UPDATE rdt.transactions SET subdoc_id=$1 WHERE id = ANY($2)', [subdocId, subdocTargetIds]);

    // Exactly one target dinas per pair, so this is a single comment + notification block —
    // anchor to the highest attached id, matching dashboard.js's own top-level-comment convention.
    // closing_description is optional, but the NOTIFICATION always fires regardless — the target
    // dinas may be actively waiting on it to know their repost landed. A comment still needs SOME
    // body (rdt.comments.body stays NOT NULL), so an empty closing_description falls back to a
    // short system-generated line instead of skipping the whole block.
    const commentBody = closingDescription || `Repost ${dinasInisiasi} → ${dinasTarget} dikonfirmasi oleh TAB (subdoc ${subdocNumber}).`;
    const notifiedUserIds = [];
    {
      const anchorId = attachRes.rows.reduce((max, row) => Math.max(max, row.id), 0);
      const directory = await loadDirectory();
      const commentRes = await client.query(
        `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body)
         VALUES ($1, NULL, $2, $3) RETURNING id`,
        [anchorId, userId, commentBody]
      );
      const commentId = commentRes.rows[0].id;
      // Implicit dinasTarget recipients (this closing description IS addressed to them) PLUS
      // anyone explicitly @mentioned. A mention of a dinas outside THIS pair must not leak a
      // notification that reveals this pair's existence to them — see mentionRules.js's filterMentionsToPair.
      const mentioned = filterMentionsToPair(resolveMentionedUserIds(commentBody, directory), directory, [dinasInisiasi, dinasTarget]);
      const recipientIds = new Set(mentioned);
      Object.keys(directory).forEach((id) => {
        if (String(directory[id].dinas).toUpperCase() === String(dinasTarget).toUpperCase()) recipientIds.add(id);
      });
      recipientIds.delete(userId);
      for (const recipientId of recipientIds) {
        await client.query(
          'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
          [recipientId, commentId]
        );
        notifiedUserIds.push(recipientId);
      }
    }

    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [userId, 'EXPORT_BATCH_CONFIRM', 'WAITING', 'CONFIRMED', JSON.stringify({ batch_id: batchId, dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, closing_description: closingDescription, attached_count: attachRes.rowCount, notified_user_ids: notifiedUserIds }), req.ip]
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [userId, 'SUBDOC_ADDED', 'CONFIRMED', 'CONFIRMED', JSON.stringify({ batch_id: batchId, dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, subdoc_number: subdocNumber, transaction_ids: subdocTargetIds }), req.ip]
    );
    return { batch_id: batchId, attached_count: attachRes.rowCount, notified_user_ids: notifiedUserIds, subdoc_number: subdocNumber };
  });
  if (!outcome.ok) return res.status(outcome.httpStatus).json({ ok: false, error: outcome.error, error_category: outcome.errorCategory });
  res.json({ ok: true, batch_id: outcome.result.batch_id, attached_count: outcome.result.attached_count, notified_user_ids: outcome.result.notified_user_ids, subdoc_number: outcome.result.subdoc_number });
});

// SAP's line-item cap is ~300 rows, same as the subdoc limit — a pair whose CONFIRMED rows exceed
// it can't physically be posted as one file, so it must download as several ≤300-row files
// instead of one file TAB has to cut apart by hand. Rows arrive pre-sorted `ORDER BY id` from the
// caller, and chunking preserves that order (simple slice, not a re-sort) — the exact same order
// GET /:batchId/lines shows the TAB-facing subdoc-entry picker in, so "file 1" lines up with
// "subdoc 1" without TAB having to cross-reference anything.
const MAX_ROWS_PER_FILE = 300;

function buildContractWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Detail');
  sheet.columns = CONTRACT_FIELDS.map((f) => ({ header: f.variants[0], key: f.key, width: 16 }));
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
}

// SRS.md "TERJAWAB 15 Agu" — output-side mapping only, from the official Format_Detail_Transaksi.xlsx
// ("Format TAB" sheet, 8 columns). Fields are RENAMED, not new data: Account->Cost.Element,
// In PCLC->Amount (read from `nominal`, the already-processed value). Qty/UoM are fixed constants
// (1 / 'EA'), not derived from any row data. Text is a literal concatenation of 4 fields, not a
// separate stored field. Header "Text " keeps the official template's trailing space verbatim.
//
// This is an ADDITIONAL export option alongside the full 53-column contract format
// (buildContractWorkbookBuffer) — does not replace it. Whether input parsing should also switch to
// the sibling "Format CBO" sheet's explicit Recipient column is a separate, still-open question
// (see SRS.md) and is NOT implemented here.
const FORMAT_TAB_SQL_COLS = ['dinas_inisiasi', 'dinas_target', 'account', 'nominal', 'curr', 'ref_doc', 'period'];

function buildFormatTabWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Format TAB');
  sheet.columns = [
    { header: 'Requester', key: 'requester', width: 14 },
    { header: 'Cost.Element', key: 'cost_element', width: 16 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Curr.', key: 'curr', width: 8 },
    { header: 'Recipient', key: 'recipient', width: 14 },
    { header: 'Qty', key: 'qty', width: 6 },
    { header: 'UoM', key: 'uom', width: 6 },
    { header: 'Text ', key: 'text', width: 40 },
  ];
  rows.forEach((row) => {
    sheet.addRow({
      requester: row.dinas_inisiasi,
      cost_element: row.account,
      amount: row.nominal,
      curr: row.curr,
      recipient: row.dinas_target,
      qty: 1,
      uom: 'EA',
      text: `${row.dinas_inisiasi || ''} to ${row.dinas_target || ''} ${row.ref_doc || ''} ${row.period || ''}`,
    });
  });
  return workbook.xlsx.writeBuffer();
}

// Shared by both export routes below — CONFIRMED rows only. `format` picks the column shape:
// 'contract' (default) is the full 53-column format, 'tab' is the 8-column Format TAB above.
// <=300 rows streams a single .xlsx; >300 rows streams a .zip of chunk-1.xlsx, chunk-2.xlsx, ...
// (jszip, already a dependency via exceljs) so nothing downstream has to guess which case it got
// beyond checking the file extension.
async function streamContractExport(res, rows, dinasInisiasi, dinasTarget, format) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const suffix = format === 'tab' ? '_FormatTAB' : '';
  const baseName = `${dinasInisiasi}-${dinasTarget}_${dateStr}${suffix}`;
  const buildBuffer = format === 'tab' ? buildFormatTabWorkbookBuffer : buildContractWorkbookBuffer;

  if (rows.length <= MAX_ROWS_PER_FILE) {
    const buffer = await buildBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.end(buffer);
    return;
  }

  const zip = new JSZip();
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_FILE) {
    const chunkIndex = Math.floor(i / MAX_ROWS_PER_FILE) + 1;
    const chunkRows = rows.slice(i, i + MAX_ROWS_PER_FILE);
    const buffer = await buildBuffer(chunkRows);
    zip.file(`chunk-${chunkIndex}.xlsx`, buffer);
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);
  res.end(zipBuffer);
}

// GET /api/export-batches/export/:batchId — full 53 contract columns (Account..Value Date),
// CONFIRMED rows only, for this batch. One batch = one pair, so the pair is read straight off the
// batch row. Kept alongside GET /export-pair/... below for batches that already exist — this
// route still works for anything reached from Riwayat Repost TAB.
router.get('/export/:batchId', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { batchId } = req.params;
  const format = req.query.format === 'tab' ? 'tab' : 'contract';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const batchRes = await client.query('SELECT dinas_inisiasi, dinas_target FROM rdt.export_batches WHERE id=$1', [batchId]);
    if (!batchRes.rows.length) return res.status(404).json({ ok: false, error: 'batch not found: ' + batchId });
    const { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget } = batchRes.rows[0];

    const cols = format === 'tab' ? FORMAT_TAB_SQL_COLS : CONTRACT_FIELDS.map((f) => f.key);
    const r = await client.query(
      `SELECT ${cols.join(',')} FROM rdt.transactions
       WHERE export_batch_id=$1 AND status_konfirmasi='CONFIRMED'
       ORDER BY id`,
      [batchId]
    );
    await streamContractExport(res, r.rows, dinasInisiasi, dinasTarget, format);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

// GET /api/export-batches/export-pair/:dinasInisiasi/:dinasTarget — the file download must be
// available the MOMENT a pair shows up in GET /waiting, not gated behind TAB clicking Confirm
// first ("Waiting to repost" is already the state — Confirm now means entering the first subdoc,
// see POST /confirm below). Same 53 contract columns / CONFIRMED-only filter as
// GET /export/:batchId, just read directly off the pair's still-unbatched rows (export_batch_id
// IS NULL) instead of an existing batch row — no state changes here at all, purely a read.
router.get('/export-pair/:dinasInisiasi/:dinasTarget', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { dinasInisiasi, dinasTarget } = req.params;
  const format = req.query.format === 'tab' ? 'tab' : 'contract';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const cols = format === 'tab' ? FORMAT_TAB_SQL_COLS : CONTRACT_FIELDS.map((f) => f.key);
    const r = await client.query(
      `SELECT ${cols.join(',')} FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi='CONFIRMED'
       ORDER BY id`,
      [dinasInisiasi, dinasTarget]
    );
    await streamContractExport(res, r.rows, dinasInisiasi, dinasTarget, format);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
