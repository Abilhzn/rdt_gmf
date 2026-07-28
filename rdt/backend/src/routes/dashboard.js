// REQ-RDT-NAV-02 (Dashboard) — rebuilt to match the updated Figma (node 1:2, "Dashboard").
// This is a PERSONALIZED view keyed off the logged-in user's own dinas (req.rdtUser.dinas) for
// regular PIC users — see the annotations on the Figma frame itself:
//
//   "Dashboard isinya progress pengkonfirmasian dari berbagai dinas yang di mention oleh
//    pengaju. [...] klo misalkan ada dinas yang reject berapapun DT nya, itu diberikan
//    pemberitahuan dibawah progress circle nya. Jika [User] tidak mengajukan repost, section
//    ini kosong."
//   -> as_initiator: one row per TARGET dinas that MY OWN dinas has submitted to, with the
//      declined-notification scoped to that exact (me -> that target) relationship. Empty
//      array if my dinas hasn't initiated anything.
//
//   "Menampilkan pengajuan dari dinas lain yang melibatkan [User] untuk mengkonfirmasi
//    pengajuannya. Jika [User] tidak dibutuhkan untuk konfirm repost di dinas manapun,
//    section ini kosong."
//   -> need_to_confirm: distinct INITIATOR dinas with PENDING rows targeting my dinas. Empty
//      array if nothing's waiting on me.
//
// TAB staff get a GLOBAL view instead (confirmed with project owner):
// TAB doesn't originate reposts itself, so a personal as_initiator view would always be empty
// for them — they see progress grouped by EVERY dinas that has submitted anything, across the
// whole system ("orang TAB bisa ngeliat semua progres dari semua dinas/akun yg ngajuin").
//
// "Chain" resolution (confirmed with project owner): once a transaction is reassigned to a new
// dinas_target, it stops being counted in its old target's group entirely under a naive
// GROUP BY dinas_target — that read as broken ("kok ga 100% padahal udah confirmed di dinas
// baru"). The rule: once a transaction resolves (CONFIRMED/BORNE_BY_INITIATOR) at its CURRENT
// target, every dinas it was EVER targeted at (reconstructed from rdt.audit_log's
// REASSIGN/REJECT_REDIRECT history) should also count it as resolved — "kek chain gitu
// konsepnya". See buildChainAwareProgress below.

const express = require('express');
const { Client } = require('pg');
const { requireUser } = require('../middleware/auth');
const { resolveMentionedUserIds } = require('../rules/mentionRules');
const { loadDirectory } = require('../dataUserClient');

const router = express.Router();
router.use(requireUser);

// DECLINED is intentionally NOT resolved: responsibility for a declined row still sits with
// the mentioned dinas until it becomes CONFIRMED, BORNE_BY_INITIATOR, or is reassigned (which
// flips it back to PENDING under a new dinas_target) — counting it as "resolved" here would let
// percent hit 100% while declined_pending_action is still > 0, a contradictory UI state.
const RESOLVED_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR'];
const ACTIONABLE_STATUSES = ['PENDING', 'CONFIRMED', 'DECLINED', 'BORNE_BY_INITIATOR'];

// Shared by buildChainAwareProgress (groupBy:'target') and getPairTransactions below — both
// need "which dinas did this transaction pass through before landing at its current target".
async function fetchReassignChainMap(client, transactionIds) {
  if (!transactionIds.length) return {};
  const auditRes = await client.query(
    `SELECT transaction_id, detail FROM rdt.audit_log
     WHERE transaction_id = ANY($1) AND action IN ('REASSIGN', 'REJECT_REDIRECT')
     ORDER BY transaction_id, id ASC`,
    [transactionIds]
  );
  const chainMap = {};
  for (const row of auditRes.rows) {
    const fromDinas = row.detail && row.detail.from_dinas;
    if (!fromDinas) continue;
    const id = row.transaction_id;
    if (!chainMap[id]) chainMap[id] = [];
    if (!chainMap[id].includes(fromDinas)) chainMap[id].push(fromDinas);
  }
  return chainMap;
}

// Shared by buildChainAwareProgress and buildNeedToConfirmProgress — Figma nodes 1:2/69:209
// (28 Jul, project owner design-detail pass) show a "N reply" count on every dashboard pair
// card, not just the percent ring. One batched query per call site rather than per-transaction,
// so a dashboard load with dozens of transactions doesn't turn into dozens of round trips.
async function fetchReplyCounts(client, transactionIds) {
  if (!transactionIds.length) return {};
  const res = await client.query(
    `SELECT transaction_id, COUNT(*)::int AS c FROM rdt.comments WHERE transaction_id = ANY($1) GROUP BY transaction_id`,
    [transactionIds]
  );
  const map = {};
  res.rows.forEach((r) => { map[r.transaction_id] = r.c; });
  return map;
}

// groupBy: 'target' expands each transaction across every dinas it was EVER targeted at (its
// current dinas_target plus every from_dinas in its reassignment chain) — used for the
// personal as_initiator view. 'initiator' groups by dinas_inisiasi, which never changes on
// reassignment, so no chain expansion is needed there — used for the TAB global view.
async function buildChainAwareProgress(client, { initiatorDinas, groupBy }) {
  const whereParts = ['dinas_target IS NOT NULL', 'status_konfirmasi = ANY($1)'];
  const params = [ACTIONABLE_STATUSES];
  if (initiatorDinas) {
    whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
    params.push(initiatorDinas);
  }
  const txRes = await client.query(
    `SELECT id, dinas_inisiasi, dinas_target, status_konfirmasi, reassign_count
     FROM rdt.transactions WHERE ${whereParts.join(' AND ')}`,
    params
  );
  const transactions = txRes.rows;

  let chainMap = {}; // transaction id -> [dinas codes it passed through before its current target]
  if (groupBy === 'target') {
    const reassignedIds = transactions.filter((t) => t.reassign_count > 0).map((t) => t.id);
    chainMap = await fetchReassignChainMap(client, reassignedIds);
  }
  const replyCounts = await fetchReplyCounts(client, transactions.map((t) => t.id));

  const agg = {}; // dinas code -> { total, resolved, declined_pending_action, reply_count }
  const bump = (key, resolved, declinedPending, replyCount) => {
    if (!agg[key]) agg[key] = { total: 0, resolved: 0, declined_pending_action: 0, reply_count: 0 };
    agg[key].total += 1;
    if (resolved) agg[key].resolved += 1;
    if (declinedPending) agg[key].declined_pending_action += 1;
    agg[key].reply_count += replyCount;
  };
  for (const t of transactions) {
    const resolved = RESOLVED_STATUSES.includes(t.status_konfirmasi);
    const declinedPending = t.status_konfirmasi === 'DECLINED';
    const replyCount = replyCounts[t.id] || 0;
    if (groupBy === 'target') {
      const chainDinas = new Set([t.dinas_target, ...(chainMap[t.id] || [])]);
      for (const d of chainDinas) bump(d, resolved, declinedPending, replyCount);
    } else {
      bump(t.dinas_inisiasi, resolved, declinedPending, replyCount);
    }
  }

  return Object.keys(agg).sort().map((dinas) => {
    const a = agg[dinas];
    return {
      dinas,
      total: a.total,
      resolved: a.resolved,
      percent: a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
      declined_pending_action: a.declined_pending_action,
      reply_count: a.reply_count,
    };
  });
}

// "Need to Confirm" rich cards (28 Jul, Figma nodes 1:2/69:209): percent + reply count per
// initiator dinas, not just the bare dinas-code list fetchNeedToConfirmDinas returns for the
// sidebar badge. Same export-batch visibility rule as fetchNeedToConfirmDinas (stays listed
// until TAB approves the batch, not just until PENDING hits zero) — grouped by INITIATOR dinas,
// no chain expansion needed (dinas_inisiasi never changes on reassignment, unlike dinas_target).
async function buildNeedToConfirmProgress(client, targetDinasCodes) {
  const txRes = await client.query(
    `SELECT t.id, t.dinas_inisiasi, t.status_konfirmasi
     FROM rdt.transactions t
     LEFT JOIN rdt.export_batches b ON b.id = t.export_batch_id
     WHERE UPPER(t.dinas_target) = ANY($1)
       AND t.status_konfirmasi = ANY($2)
       AND (t.export_batch_id IS NULL OR b.status NOT IN ('APPROVED','EXPORTED'))`,
    [targetDinasCodes, ACTIONABLE_STATUSES]
  );
  const transactions = txRes.rows;
  const replyCounts = await fetchReplyCounts(client, transactions.map((t) => t.id));

  const agg = {};
  for (const t of transactions) {
    const key = t.dinas_inisiasi;
    if (!agg[key]) agg[key] = { total: 0, resolved: 0, reply_count: 0 };
    agg[key].total += 1;
    if (RESOLVED_STATUSES.includes(t.status_konfirmasi)) agg[key].resolved += 1;
    agg[key].reply_count += replyCounts[t.id] || 0;
  }
  return Object.keys(agg).sort().map((dinas) => {
    const a = agg[dinas];
    return {
      dinas,
      total: a.total,
      resolved: a.resolved,
      percent: a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
      reply_count: a.reply_count,
    };
  });
}

// REQ-RDT-NAV-03 (Dashboard-Detailing): every transaction initiated by `initiatorDinas` whose
// CURRENT dinas_target is `targetDinas`, OR whose reassignment chain ever passed through
// `targetDinas` — same "once you're in the chain, you stay counted" rule buildChainAwareProgress
// uses for the pair's own progress numbers, so the transaction list and the percent agree.
async function getPairTransactions(client, initiatorDinas, targetDinas) {
  const txRes = await client.query(
    `SELECT id, account, nominal, status_konfirmasi, ref_doc, remark, dinas_target, reassign_count
     FROM rdt.transactions WHERE dinas_inisiasi=$1 AND dinas_target IS NOT NULL AND status_konfirmasi = ANY($2)`,
    [initiatorDinas, ACTIONABLE_STATUSES]
  );
  const transactions = txRes.rows;
  const reassignedIds = transactions.filter((t) => t.reassign_count > 0).map((t) => t.id);
  const chainMap = await fetchReassignChainMap(client, reassignedIds);
  const targetUpper = String(targetDinas).toUpperCase();
  return transactions.filter((t) => {
    const chainDinas = new Set([t.dinas_target, ...(chainMap[t.id] || [])].map((d) => String(d).toUpperCase()));
    return chainDinas.has(targetUpper);
  });
}

// REQ-RDT-NAV-03/COMMENT: who may view or post in a dinas pair's drill-down + comment thread —
// PIC of either dinas in the pair, or TAB (role TAB sees every pair's dashboard detail +
// comment thread, per project owner correction 24 Jul — SM_TA/GH_TA roles removed entirely).
function canAccessPair(user, initiatorDinas, targetDinas) {
  if (user.role === 'TAB') return true;
  const myDinas = String(user.dinas).toUpperCase();
  return myDinas === String(initiatorDinas).toUpperCase() || myDinas === String(targetDinas).toUpperCase();
}

// Comments attach to one specific transaction row (schema: transaction_id NOT NULL), but this
// page's thread is scoped to a PAIR, not a transaction (see plan discussion, option A chosen by
// project owner 23 Jul 2026: no schema change). A new top-level comment anchors to the pair's
// most-recently-created transaction; a reply just inherits its parent comment's transaction_id
// instead of trusting any client-supplied id. Reading the thread means merging comments across
// EVERY transaction in the pair by time, so it reads as one continuous conversation regardless
// of which specific row each comment happens to be anchored to.
async function getPairCommentThread(client, pairTransactionIds) {
  if (!pairTransactionIds.length) return [];
  const directory = await loadDirectory();
  const res = await client.query(
    `SELECT id, transaction_id, parent_comment_id, author_user_id, body, created_at
     FROM rdt.comments WHERE transaction_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [pairTransactionIds]
  );
  return res.rows.map((c) => ({
    id: c.id,
    parent_comment_id: c.parent_comment_id,
    author_user_id: c.author_user_id,
    author_display_name: (directory[c.author_user_id] && directory[c.author_user_id].display_name) || c.author_user_id,
    body: c.body,
    created_at: c.created_at,
  }));
}

router.get('/detail/:initiatorDinas/:targetDinas', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { initiatorDinas, targetDinas } = req.params;
  if (!canAccessPair(req.rdtUser, initiatorDinas, targetDinas)) {
    return res.status(403).json({ ok: false, error: `user ${req.rdtUser.id} not authorized for pair ${initiatorDinas}->${targetDinas}` });
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const progressList = await buildChainAwareProgress(client, { initiatorDinas, groupBy: 'target' });
    const progress = progressList.find((p) => String(p.dinas).toUpperCase() === String(targetDinas).toUpperCase())
      || { dinas: targetDinas, total: 0, resolved: 0, percent: 0, declined_pending_action: 0 };
    const transactions = await getPairTransactions(client, initiatorDinas, targetDinas);
    const comments = await getPairCommentThread(client, transactions.map((t) => t.id));
    res.json({ ok: true, initiator_dinas: initiatorDinas, target_dinas: targetDinas, progress, transactions, comments });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

router.get('/detail/:initiatorDinas/:targetDinas/comments', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { initiatorDinas, targetDinas } = req.params;
  if (!canAccessPair(req.rdtUser, initiatorDinas, targetDinas)) {
    return res.status(403).json({ ok: false, error: `user ${req.rdtUser.id} not authorized for pair ${initiatorDinas}->${targetDinas}` });
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const transactions = await getPairTransactions(client, initiatorDinas, targetDinas);
    const comments = await getPairCommentThread(client, transactions.map((t) => t.id));
    res.json({ ok: true, comments });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

router.post('/detail/:initiatorDinas/:targetDinas/comments', express.json(), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { initiatorDinas, targetDinas } = req.params;
  if (!canAccessPair(req.rdtUser, initiatorDinas, targetDinas)) {
    return res.status(403).json({ ok: false, error: `user ${req.rdtUser.id} not authorized for pair ${initiatorDinas}->${targetDinas}` });
  }
  const body = (req.body && req.body.body || '').trim();
  const parentCommentId = req.body && req.body.parent_comment_id;
  if (!body) return res.status(400).json({ ok: false, error: 'body is required' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');

    let transactionId;
    if (parentCommentId) {
      const parentRes = await client.query('SELECT transaction_id FROM rdt.comments WHERE id=$1', [parentCommentId]);
      if (!parentRes.rows.length) throw new Error(`parent_comment_id ${parentCommentId} not found`);
      transactionId = parentRes.rows[0].transaction_id;
    } else {
      const transactions = await getPairTransactions(client, initiatorDinas, targetDinas);
      if (!transactions.length) throw new Error(`no transactions exist yet for pair ${initiatorDinas}->${targetDinas} to anchor a comment to`);
      transactionId = transactions.reduce((max, t) => (t.id > max ? t.id : max), transactions[0].id);
    }

    const insertRes = await client.query(
      `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [transactionId, parentCommentId || null, req.rdtUser.id, body]
    );
    const commentId = insertRes.rows[0].id;

    // REQ-RDT-COMMENT-03: purely notify-only, no transaction/reassignment side effects.
    const directory = await loadDirectory();
    const mentionedUserIds = resolveMentionedUserIds(body, directory).filter((id) => id !== req.rdtUser.id);
    for (const recipientId of mentionedUserIds) {
      await client.query(
        'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
        [recipientId, commentId]
      );
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      comment: {
        id: commentId,
        transaction_id: transactionId,
        parent_comment_id: parentCommentId || null,
        author_user_id: req.rdtUser.id,
        author_display_name: req.rdtUser.display_name,
        body,
        created_at: insertRes.rows[0].created_at,
      },
      notified: mentionedUserIds,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(400).json({ ok: false, error: String(err.message || err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// Need to Confirm (project owner correction, 25 Jul): an initiator dinas must NOT drop out of
// this list the instant its PENDING rows targeting me hit zero — other target dinas from the
// same initiator's submission may still be mid-confirmation, and even once every row here is
// CONFIRMED/BORNE, the pair should stay visible until TAB has actually approved the export
// batch that swept it up (see exportBatches.js's DRAFT->WAITING_APPROVAL->APPROVED flow) —
// "jangan ilang sebelum di-confirm oleh TAB". So: keep any dinas_inisiasi with an ACTIONABLE
// row targeting me that hasn't yet landed in an APPROVED/EXPORTED batch, not just PENDING ones.
//
// TAB also staffs dinas "Corp"'s AND "TA"'s queues (neither has a dedicated PIC,
// REQ-RDT-AUTH-04) — their dinas_target rows never showed up under myDinas='TAB' before this
// fix. ('TA' added 28 Jul alongside the project owner's TA-is-a-real-target correction — see
// schema.sql's rdt.dinas seed comment.)
//
function needToConfirmTargetCodes(myDinas, isTabStaff) {
  return (isTabStaff ? [myDinas, 'Corp', 'TA'] : [myDinas]).map((d) => String(d).toUpperCase());
}

// Bare dinas-code list, no percent/reply-count aggregation — used ONLY by GET
// /need-to-confirm-count (REQ-RDT-NAV-02a's sidebar badge, called on every page load) so that
// route stays a single cheap DISTINCT query instead of paying for buildNeedToConfirmProgress's
// per-transaction reply-count join just to get a count.
async function fetchNeedToConfirmDinas(client, targetDinasCodes) {
  const res = await client.query(
    `SELECT DISTINCT t.dinas_inisiasi AS dinas
     FROM rdt.transactions t
     LEFT JOIN rdt.export_batches b ON b.id = t.export_batch_id
     WHERE UPPER(t.dinas_target) = ANY($1)
       AND t.status_konfirmasi = ANY($2)
       AND (t.export_batch_id IS NULL OR b.status NOT IN ('APPROVED','EXPORTED'))
     ORDER BY dinas`,
    [targetDinasCodes, ACTIONABLE_STATUSES]
  );
  return res.rows.map((r) => r.dinas);
}

router.get('/summary', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const myDinas = req.rdtUser.dinas;
  const isTabStaff = req.rdtUser.role === 'TAB';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    const asInitiator = isTabStaff
      ? await buildChainAwareProgress(client, { initiatorDinas: null, groupBy: 'initiator' })
      : await buildChainAwareProgress(client, { initiatorDinas: myDinas, groupBy: 'target' });
    // Rich per-pair cards (percent + reply count), not just the bare dinas-code list — see
    // buildNeedToConfirmProgress's header comment (Figma nodes 1:2/69:209, 28 Jul).
    const needToConfirm = await buildNeedToConfirmProgress(client, needToConfirmTargetCodes(myDinas, isTabStaff));

    res.json({ ok: true, own_dinas: myDinas, as_initiator: asInitiator, need_to_confirm: needToConfirm, is_global_view: isTabStaff });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// REQ-RDT-NAV-02a: lightweight count-only endpoint for the sidebar "Dashboard" badge, visible
// from any page — called once at shell load (see selectPlatform() in ui-demo.html), not the
// full /summary aggregation. Deliberately just a count, not the dinas list itself, so this stays
// cheap to call opportunistically (e.g. after Confirmation submit) without re-fetching more than
// the badge needs.
router.get('/need-to-confirm-count', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const myDinas = req.rdtUser.dinas;
  const isTabStaff = req.rdtUser.role === 'TAB';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const needToConfirm = await fetchNeedToConfirmDinas(client, needToConfirmTargetCodes(myDinas, isTabStaff));
    res.json({ ok: true, count: needToConfirm.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

module.exports = router;
