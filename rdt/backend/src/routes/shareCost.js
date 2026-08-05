const express = require('express');
const { Client } = require('pg');
const { requireUser, requireRole } = require('../middleware/auth');
const { resolveMentionedUserIds, filterMentionsToPair } = require('../rules/mentionRules');
const { buildValidCodeMap } = require('../rules/reassignmentRules');
const { loadDirectory } = require('../dataUserClient');

const router = express.Router();

// Mounted at /api/share-cost in index.js. SRS section 3.10, "seadanya" version (locked
// assumptions 3 Agu): TAB can split ONE PENDING row into several PENDING rows with different
// (dinas_target, nominal) pairs -- e.g. a 100rb row entirely under TH gets split into 35rb TH +
// 65rb TU. Locked to PENDING-only (no ledger_entries exist yet for those rows, so nothing to
// unwind) -- CONFIRMED rows would need a separate ledger-reversal design, out of scope here.
router.use(requireUser, requireRole('TAB'));

// GET /api/share-cost/candidates?q=... — PENDING rows TAB can pick from.
// PERSEMPIT SCOPE (4 Agu, revisi rencana pemilik proyek): originally unscoped ("any PENDING row
// system-wide" — see git history for the old comment) — now ONLY rows whose dinas_target is
// ALREADY DIRECTLY 'TAB' (not Corp, not a plain dinas, not an unassigned Ask TA/investigation
// row) are share-cost candidates. 'TAB' is now a legitimate dinas_target VALUE a parsed Remarks
// prefix can resolve to (see config/dinas.codes.json), not just a role — see section 3.10.
// `q` optionally filters by account/ref_doc/remark substring (case-insensitive) so TAB can find
// the one row they mean without paging through the entire TAB-targeted PENDING backlog.
router.get('/candidates', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const q = req.query.q ? String(req.query.q).trim() : '';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const params = [];
    let where = `t.status_konfirmasi = 'PENDING' AND t.dinas_target = 'TAB'`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (t.account ILIKE $${params.length} OR t.ref_doc ILIKE $${params.length} OR t.remark ILIKE $${params.length})`;
    }
    const r = await client.query(
      `SELECT t.id, t.dinas_inisiasi, t.dinas_target, t.account, t.nominal, t.remark, t.ref_doc, t.period,
              t.upload_id, u.original_filename AS upload_filename
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT 100`,
      params
    );
    res.json({ ok: true, rows: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/share-cost/:transactionId/split — body: { splits: [{ dinas_target, nominal }, ...], note }.
// note is REQUIRED (it's the audit trail's stated reason, same "mandatory closing description"
// convention already used for Need Approval's confirm form and Investigation's assign-all).
router.post('/:transactionId/split', express.json(), async (req, res) => {
  const transactionId = req.params.transactionId;
  const splits = req.body && req.body.splits;
  const note = req.body && req.body.note;
  const userId = req.rdtUser.id;

  const trimmedNote = note && String(note).trim();
  if (!trimmedNote) return res.status(400).json({ ok: false, error: 'note (alasan split) wajib diisi' });
  if (!Array.isArray(splits) || splits.length < 2) {
    return res.status(400).json({ ok: false, error: 'splits harus berisi minimal 2 baris' });
  }
  for (const s of splits) {
    if (!s || !s.dinas_target || typeof s.nominal !== 'number' || !Number.isFinite(s.nominal) || s.nominal === 0) {
      return res.status(400).json({ ok: false, error: 'setiap baris split wajib punya dinas_target dan nominal (angka, tidak nol)' });
    }
  }

  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');

    const q = await client.query(
      'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, nominal FROM rdt.transactions WHERE id=$1 FOR UPDATE',
      [transactionId]
    );
    if (!q.rows.length) throw new Error('transaction not found: ' + transactionId);
    const original = q.rows[0];
    if (original.status_konfirmasi !== 'PENDING') {
      throw new Error('hanya baris PENDING yang bisa di-split (baris ini: ' + original.status_konfirmasi + ')');
    }

    // BUG FIX (5 Agu, live report — "assign ke Corp gagal 500, FK violation"): this used to
    // validate against an all-uppercased Set but then insert the RAW (not-necessarily-matching-
    // case) s.dinas_target below — rdt.dinas stores a few codes mixed-case ('Corp'), so a
    // lowercase/mismatched-case submission passed this check yet still violated the FK at INSERT
    // time. buildValidCodeMap resolves each split's target to its actual stored-case code ONCE
    // here, reused at INSERT time below instead of re-deriving (and re-risking) the case there.
    const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
    const validCodes = buildValidCodeMap(validRes.rows);
    for (const s of splits) {
      const matchedCode = validCodes.get(String(s.dinas_target).toUpperCase());
      if (!matchedCode) {
        throw new Error('dinas_target tidak valid: ' + s.dinas_target);
      }
      s.dinas_target = matchedCode;
    }

    // Validasi wajib (SRS 3.10): SUM nominal seluruh baris hasil split HARUS PERSIS SAMA dengan
    // nominal baris asli -- dibandingkan dalam sen (integer) supaya tidak salah karena floating point.
    const originalCents = Math.round(Number(original.nominal) * 100);
    const sumCents = splits.reduce((acc, s) => acc + Math.round(s.nominal * 100), 0);
    if (sumCents !== originalCents) {
      throw new Error(`SUM nominal split (${(sumCents / 100).toFixed(2)}) harus persis sama dengan nominal baris asli (${(originalCents / 100).toFixed(2)})`);
    }

    await client.query(
      `UPDATE rdt.transactions SET status_konfirmasi='SPLIT_VOID' WHERE id=$1`,
      [original.id]
    );

    const newIds = [];
    for (const s of splits) {
      const insertRes = await client.query(
        `INSERT INTO rdt.transactions (
           upload_id, dinas_inisiasi, dinas_target, nominal, category, status_konfirmasi, is_reversal, invalid_reason,
           account, cost_ctr, profit_ctr, partner_pc, document_no, ref_doc, period, text_desc, acc_text, sap_user,
           sales_doc, wbs_elem, purch_doc, order_no, fiscal_year, elim_prctr, obj_class, customer, vendor, plant,
           material, time_val, year_2, ref_org_un, val_a, mvt, type, sales_ord, s_no, bus_a, func_area, acty,
           asset, rep_mat, ar, dt, ref_tran, item, bill_t, sd_doc, s_grp, s_off, co_ar, in_pclc, curr,
           doc_date, pstng_date, in_ccc, in_tc, qty, unit, entry_dte, value_date,
           sheet_name, raw_row_index, remark, raw_payload, sub_group, split_from_transaction_id
         )
         SELECT
           upload_id, dinas_inisiasi, $2, $3, category, 'PENDING', is_reversal, invalid_reason,
           account, cost_ctr, profit_ctr, partner_pc, document_no, ref_doc, period, text_desc, acc_text, sap_user,
           sales_doc, wbs_elem, purch_doc, order_no, fiscal_year, elim_prctr, obj_class, customer, vendor, plant,
           material, time_val, year_2, ref_org_un, val_a, mvt, type, sales_ord, s_no, bus_a, func_area, acty,
           asset, rep_mat, ar, dt, ref_tran, item, bill_t, sd_doc, s_grp, s_off, co_ar, in_pclc, curr,
           doc_date, pstng_date, in_ccc, in_tc, qty, unit, entry_dte, value_date,
           sheet_name, raw_row_index, remark, raw_payload, sub_group, $1
         FROM rdt.transactions WHERE id=$1
         RETURNING id`,
        [original.id, s.dinas_target, s.nominal]
      );
      newIds.push(insertRes.rows[0].id);
    }

    await client.query(
      'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail) VALUES($1,$2,$3,$4,$5,$6)',
      [userId, original.id, 'SPLIT_BY_TAB', 'PENDING', 'SPLIT_VOID', JSON.stringify({ split_into: newIds, note: trimmedNote, splits })]
    );

    // Notifikasi ke dinas asal (SRS 3.10): komentar otomatis di thread pasangan ASLI
    // (dinas_inisiasi -> dinas_target lama), dikirim SETELAH split selesai -- dinas yang tadinya
    // memegang seluruh nominal perlu tahu klaimnya baru saja diubah. Reuses the shared
    // @mention parse+notify system (REQ-RDT-COMMENT-03), same pattern as investigation.js's
    // postPairComment.
    const parentRes = await client.query(
      `SELECT c.id, c.transaction_id FROM rdt.comments c
       JOIN rdt.transactions t ON t.id = c.transaction_id
       WHERE t.dinas_inisiasi=$1 AND t.dinas_target=$2 AND c.parent_comment_id IS NULL
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
      [original.dinas_inisiasi, original.dinas_target]
    );
    const parent = parentRes.rows[0];
    const splitSummary = splits.map((s) => `${s.dinas_target} ${s.nominal}`).join(', ');
    const commentBody = `[Share-Cost split oleh TAB] Baris ini dibelah jadi: ${splitSummary}. ${trimmedNote}`;
    const commentRes = await client.query(
      `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [parent ? parent.transaction_id : original.id, parent ? parent.id : null, userId, commentBody]
    );
    const commentId = commentRes.rows[0].id;
    const directory = await loadDirectory();
    // Privacy bug fix (4 Agu): this comment is posted on the ORIGINAL pair's thread — a mention
    // of a NEW split-target dinas (or any other dinas outside this pair) must not leak a
    // notification revealing this pair to them. See mentionRules.js's filterMentionsToPair.
    const mentioned = filterMentionsToPair(resolveMentionedUserIds(commentBody, directory), directory, [original.dinas_inisiasi, original.dinas_target]);
    const recipientIds = new Set(mentioned);
    Object.keys(directory).forEach((id) => {
      if (String(directory[id].dinas).toUpperCase() === String(original.dinas_target).toUpperCase()) recipientIds.add(id);
    });
    recipientIds.delete(userId);
    for (const recipientId of recipientIds) {
      await client.query('INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)', [recipientId, commentId]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, split_from: original.id, split_into: newIds });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ ok: false, error: String(err) });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
