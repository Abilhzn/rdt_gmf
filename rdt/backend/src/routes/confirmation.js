const express = require('express');
const { Client } = require('pg');
const { requireUser, requireDinasAccess } = require('../middleware/auth');
const { validateReassignTarget, buildValidCodeMap } = require('../rules/reassignmentRules');
const { resolveMentionedUserIds, filterMentionsToPair } = require('../rules/mentionRules');
const { loadDirectory } = require('../dataUserClient');
const { computeEffectivePeriod, pickDeadline } = require('../rules/periodEffective');
const { validateFreeText } = require('../rules/textValidation');
const { logRollbackAudit } = require('../logger');

const router = express.Router();

// Mounted at /api/confirmation in index.js.
// Only the target dinas's PIC or a TAB-role user may view/act on a dinas's confirmation page
// (see middleware/auth.js for the provisional TODO(IT-AUTH) mechanism).
router.use(requireUser);

// GET /api/confirmation/:dinas — list PENDING rows targeting :dinas
router.get('/:dinas', requireDinasAccess('dinas'), async (req, res) => {
  const dinas = req.params.dinas;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    // dinas_inisiasi included so the client can group/filter "Need to Confirm" by source dinas.
    // upload_id + original_filename (joined from rdt.uploads) let the UI render one "download
    // original file" button per distinct source upload without a separate endpoint.
    //
    // `t.*` instead of a hand-picked subset, matching exportBatches.js's transparency query, so
    // the frontend can show every one of the 53 contract columns. `t.sheet_name`/`t.raw_row_index`
    // come along too but stay internal-only (kept for audit, never displayed) — the frontend's
    // previewColumns list (built from GET /api/contract-fields) simply never references them.
    const r = await client.query(
      `SELECT t.*, u.original_filename AS upload_filename
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.dinas_target=$1 AND t.status_konfirmasi=$2`,
      [dinas, 'PENDING']
    );
    // Attach each row's own redirect breadcrumb (initiator -> every intermediate hop -> current
    // target, same fetchReassignChainMap logic dashboard.js uses) so this queue's badge/rows can show it too.
    const reassignedIds = r.rows.filter((t) => t.reassign_count > 0).map((t) => t.id);
    let chainMap = {};
    if (reassignedIds.length) {
      const auditRes = await client.query(
        `SELECT transaction_id, detail FROM rdt.audit_log
         WHERE transaction_id = ANY($1) AND action IN ('REASSIGN', 'REJECT_REDIRECT')
         ORDER BY transaction_id, id ASC`,
        [reassignedIds]
      );
      for (const row of auditRes.rows) {
        const fromDinas = row.detail && row.detail.from_dinas;
        if (!fromDinas) continue;
        if (!chainMap[row.transaction_id]) chainMap[row.transaction_id] = [];
        if (!chainMap[row.transaction_id].includes(fromDinas)) chainMap[row.transaction_id].push(fromDinas);
      }
    }
    const rows = r.rows.map((t) => ({ ...t, chain: [t.dinas_inisiasi, ...(chainMap[t.id] || []), dinas] }));
    res.json({ ok: true, rows });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
  finally { try { await client.end(); } catch (e) {} }
});

// POST /api/confirmation/:dinas/submit — batch CONFIRM/DECLINE
// decisions: [{ id, claim: 'YA' }] or [{ id, claim: 'TIDAK', redirect_to?: dinasCode }].
//
// redirect_to: when the declining PIC picks a specific dinas to send the rejection to, that
// reassignment executes IMMEDIATELY — the declining PIC has full authority to redirect right
// there, the initiator does NOT need to approve it first (an intentional widening of the usual
// reassignment authority, otherwise ONLY the initiator dinas can reassign via reassignment.js).
// Without redirect_to, behavior is unchanged: the row goes to DECLINED and waits for the
// initiator to choose Tanggung Sendiri/Ajukan Ulang via the existing reassignment.js flow.
//
// periode_efektif SNAPSHOT — dikunci di sini (bukan dihitung ulang saat GET /history) begitu
// dinas TARGET melakukan aksi Confirm/Reject, dibandingkan ke deadline yang berlaku saat itu juga.
// Kalau TAB edit deadline belakangan, itu tidak menyentuh baris yang sudah pernah lewat sini.
// Cuma dipanggil untuk CONFIRM dan DECLINE (aksi target yang sebenarnya) — bukan REJECT_REDIRECT
// (baris langsung pindah ke pasangan baru, belum "final" untuk pasangan ini) atau
// BORNE_BY_INITIATOR (itu keputusan inisiator, bukan target — nilai yang sudah terkunci saat
// DECLINE tetap dipakai apa adanya).
async function snapshotPeriodeEfektif(client, { transactionId, dinasInisiasi, dinasTarget, declaredPeriod }) {
  if (!declaredPeriod) return; // tidak ada periode dinyatakan -> tidak ada apa-apa buat dihitung
  const deadlineRes = await client.query(
    'SELECT deadline_at FROM rdt.period_deadlines WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND periode=$3',
    [dinasInisiasi, dinasTarget, declaredPeriod]
  );
  // Per-pasangan override (query above) wins if it exists; otherwise fall back to a periode-wide
  // default TAB may have set in advance — see rules/periodEffective.js's pickDeadline.
  const defaultRes = await client.query(
    'SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode=$1',
    [declaredPeriod]
  );
  const deadlineAt = pickDeadline(deadlineRes.rows[0], defaultRes.rows[0]);
  const { periodeEfektif } = computeEffectivePeriod({
    declaredPeriod,
    deadlineAt,
    latestTargetActionAt: new Date(),
  });
  await client.query('UPDATE rdt.transactions SET periode_efektif=$1 WHERE id=$2', [periodeEfektif, transactionId]);
}

router.post('/:dinas/submit', requireDinasAccess('dinas'), express.json(), async (req, res) => {
  const dinas = req.params.dinas;
  const decisions = req.body && req.body.decisions;
  const userId = req.rdtUser.id;
  if (!Array.isArray(decisions)) return res.status(400).json({ ok: false, error: 'invalid body, expected { decisions: [{id,claim}] }' });
  const descriptionCheck = validateFreeText(req.body && req.body.description, { fieldLabel: 'Deskripsi' });
  if (!descriptionCheck.ok) return res.status(400).json(descriptionCheck);
  const description = descriptionCheck.value;
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    const declined = [];
    const redirected = [];
    // The confirming dinas's optional description lands in the pair's Dashboard-Detailing thread
    // as a REPLY under the initiator's repost description, not a bare new comment — one per
    // distinct dinas_inisiasi represented in this submit batch.
    const initiatorTransactionId = new Map();
    let validCodes = null;
    for (const d of decisions) {
      const id = d.id;
      const claim = d.claim; // 'YA' or 'TIDAK'
      // u.period (declared period) joined in here — needed to compute this row's periode_efektif
      // snapshot below. `FOR UPDATE OF t` locks only the transactions row (what this endpoint
      // actually mutates), not the joined uploads row.
      const q = await client.query(
        `SELECT t.id, t.status_konfirmasi, t.dinas_target, t.dinas_inisiasi, t.nominal, t.account, t.remark, t.ref_doc, t.reassign_count, u.period
         FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
         WHERE t.id=$1 FOR UPDATE OF t`,
        [id]
      );
      if (!q.rows.length) throw new Error('transaction not found: ' + id);
      const row = q.rows[0];
      if (row.status_konfirmasi !== 'PENDING') throw new Error('transaction not pending: ' + id);
      if (row.dinas_target !== dinas) throw new Error('transaction target mismatch: ' + id);
      if (!initiatorTransactionId.has(row.dinas_inisiasi)) initiatorTransactionId.set(row.dinas_inisiasi, row.id);
      if (claim === 'YA') {
        await client.query('UPDATE rdt.transactions SET status_konfirmasi=$1, decided_by_user_id=$2, decided_at=now() WHERE id=$3', ['CONFIRMED', userId, id]);
        const amount = row.nominal;
        await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [id, dinas, 'DEBIT', amount]);
        await client.query('INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,$3,$4)', [id, row.dinas_inisiasi, 'CREDIT', amount]);
        await client.query('INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)', [userId, id, 'CONFIRM', 'PENDING', 'CONFIRMED', JSON.stringify({ dinas: dinas, amount: amount }), req.ip]);
        await snapshotPeriodeEfektif(client, { transactionId: id, dinasInisiasi: row.dinas_inisiasi, dinasTarget: dinas, declaredPeriod: row.period });
      } else if (claim === 'TIDAK') {
        if (d.redirect_to) {
          if (!validCodes) {
            const validRes = await client.query('SELECT code FROM rdt.dinas WHERE is_active = true');
            validCodes = buildValidCodeMap(validRes.rows);
          }
          const validation = validateReassignTarget({
            newTarget: d.redirect_to,
            validCodes,
            dinasInisiasi: row.dinas_inisiasi,
            currentDinasTarget: row.dinas_target,
            reassignCount: row.reassign_count,
          });
          if (!validation.ok) throw new Error(`id ${id}: ${validation.error}`);
          const newTargetUpper = validation.newTargetUpper;
          // periode_efektif=NULL: this row starts a fresh confirm/reject episode under a new
          // pasangan (newTargetUpper) — it isn't "final" for THIS pasangan, so no snapshot is
          // taken here; NULL defensively in case a stale value somehow survived from an earlier hop.
          await client.query(
            `UPDATE rdt.transactions
             SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from=$2, reassign_count=reassign_count+1,
                 decided_by_user_id=NULL, decided_at=NULL, periode_efektif=NULL
             WHERE id=$3`,
            [newTargetUpper, row.dinas_target, id]
          );
          await client.query(
            'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [userId, id, 'REJECT_REDIRECT', 'PENDING', 'PENDING', JSON.stringify({ rejected_by: dinas, from_dinas: row.dinas_target, to_dinas: newTargetUpper, reassign_count: row.reassign_count + 1 }), req.ip]
          );
          redirected.push({ id: row.id, account: row.account, nominal: row.nominal, remark: row.remark, ref_doc: row.ref_doc, dinas_inisiasi: row.dinas_inisiasi, redirected_to: newTargetUpper });
        } else {
          await client.query('UPDATE rdt.transactions SET status_konfirmasi=$1, decided_by_user_id=$2, decided_at=now() WHERE id=$3', ['DECLINED', userId, id]);
          await client.query('INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)', [userId, id, 'DECLINE', 'PENDING', 'DECLINED', JSON.stringify({ dinas: dinas }), req.ip]);
          declined.push({ id: row.id, account: row.account, nominal: row.nominal, remark: row.remark, ref_doc: row.ref_doc, dinas_inisiasi: row.dinas_inisiasi });
          // DECLINE (no redirect) IS a target Confirm/Reject action — snapshot now. If this row
          // later becomes BORNE_BY_INITIATOR, that value is kept as-is (BORNE is the initiator's
          // decision, not a fresh target action). If it instead gets REASSIGNed, that path NULLs this out.
          await snapshotPeriodeEfektif(client, { transactionId: id, dinasInisiasi: row.dinas_inisiasi, dinasTarget: dinas, declaredPeriod: row.period });
        }
      } else {
        throw new Error('invalid claim value for id ' + id);
      }
    }

    const trimmedDescription = description && String(description).trim();
    if (trimmedDescription) {
      // Notifies the dinas_inisiasi PIC(s) directly — this description is inherently addressed to
      // them, no @mention needed for something already implied by context. Also parses @mentions
      // in the text (resolveMentionedUserIds) so someone outside dinas_inisiasi explicitly
      // mentioned (e.g. TAB, or a third dinas) gets notified too.
      const directory = await loadDirectory();
      for (const [dinasInisiasi, fallbackTransactionId] of initiatorTransactionId) {
        const parentRes = await client.query(
          `SELECT c.id, c.transaction_id FROM rdt.comments c
           JOIN rdt.transactions t ON t.id = c.transaction_id
           WHERE t.dinas_inisiasi=$1 AND t.dinas_target=$2 AND c.parent_comment_id IS NULL
           ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
          [dinasInisiasi, dinas]
        );
        const parent = parentRes.rows[0];
        const commentRes = await client.query(
          `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
          [parent ? parent.transaction_id : fallbackTransactionId, parent ? parent.id : null, userId, trimmedDescription]
        );
        const commentId = commentRes.rows[0].id;
        // Implicit dinas_inisiasi recipients (context) PLUS anyone explicitly @mentioned in the
        // text — same union pattern as index.js's Repost description and dashboard.js's manual
        // comments. This loop runs once per distinct dinas_inisiasi in the submit batch, all
        // sharing the SAME description text — a mention meant for one pair must not leak into
        // another pair's recipient list (see mentionRules.js's filterMentionsToPair).
        const mentioned = filterMentionsToPair(resolveMentionedUserIds(trimmedDescription, directory), directory, [dinasInisiasi, dinas]);
        const recipientIds = new Set(mentioned);
        Object.keys(directory).forEach((id) => {
          if (String(directory[id].dinas).toUpperCase() === String(dinasInisiasi).toUpperCase()) recipientIds.add(id);
        });
        recipientIds.delete(userId);
        for (const recipientId of recipientIds) {
          await client.query(
            'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
            [recipientId, commentId]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, declined, redirected });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    // Categorize the failure for the user AND log the rollback to rdt.audit_log.
    const category = await logRollbackAudit(client, { userId, req, err, route: '/api/confirmation/:dinas/submit' });
    res.status(500).json({ ok: false, error: String(err), error_category: category });
  } finally { try { await client.end(); } catch (e) {} }
});

module.exports = router;
