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
const { requireUser, requireRole } = require('../middleware/auth');
const { resolveMentionedUserIds, filterMentionsToPair } = require('../rules/mentionRules');
const { loadDirectory } = require('../dataUserClient');
const { deriveStateLabel } = require('../rules/stateLabel');
const { validateFreeText } = require('../rules/textValidation');

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

// REQ-RDT-LEDGER-10 dashboard visibility (29 Jul, project owner request): NEEDS_INVESTIGATION
// rows have dinas_target=NULL, so they never appear in any of the pair-grouped queries above —
// invisible everywhere until now. Surfaced as a synthetic pseudo-card with the sentinel
// target_dinas='INVESTIGATION' (never a real dinas code, so it can't collide) wherever a real
// dinas's own submissions would otherwise show, so (a) the uploading dinas can verify the
// backend actually recognized their "Ask TA" rows (via Own Repost -> Dashboard-Detailing), and
// (b) TAB sees it needs action (via Need to Confirm). percent is always 0 — by definition
// nothing is "resolved" while still awaiting investigation.
async function fetchInvestigationCounts(client, initiatorDinas) {
  const whereParts = [`status_konfirmasi = 'NEEDS_INVESTIGATION'`];
  const params = [];
  if (initiatorDinas) {
    whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
    params.push(initiatorDinas);
  }
  const res = await client.query(
    `SELECT id, dinas_inisiasi FROM rdt.transactions WHERE ${whereParts.join(' AND ')}`,
    params
  );
  const replyCounts = await fetchReplyCounts(client, res.rows.map((r) => r.id));
  const byDinas = {};
  for (const row of res.rows) {
    if (!byDinas[row.dinas_inisiasi]) byDinas[row.dinas_inisiasi] = { total: 0, reply_count: 0 };
    byDinas[row.dinas_inisiasi].total += 1;
    byDinas[row.dinas_inisiasi].reply_count += replyCounts[row.id] || 0;
  }
  return Object.keys(byDinas).sort().map((dinas) => ({
    dinas,
    target_dinas: 'INVESTIGATION',
    total: byDinas[dinas].total,
    resolved: 0,
    percent: 0,
    declined_pending_action: 0,
    reply_count: byDinas[dinas].reply_count,
  }));
}

// groupBy: 'target' groups each transaction under its ORIGINAL target dinas — the first dinas
// it was ever sent to (chainMap[t.id][0], recorded chronologically by fetchReassignChainMap),
// falling back to its current dinas_target if it was never redirected — used for the personal
// as_initiator view (one fixed initiatorDinas, so grouping by target alone already means "one
// card per pair"). 'pair' groups by (dinas_inisiasi, original target) instead — used for TAB's
// global as_initiator view (29 Jul restructure, replacing the old 'initiator'-only grouping that
// deliberately blocked drill-down — see HomeComponent.goToDetail's old "scope cut, not an
// oversight" note, now lifted): TAB has many initiators, so collapsing by initiator alone hid
// which specific target dinas within each initiator's submissions was still outstanding.
//
// UPDATE (28 Jul, bug report): this used to bump EVERY dinas in the chain (both the original
// target AND every redirect target) as separate top-level card keys — reported live as "abis
// TM reject-redirect ke TL, TL-nya malah jadi kartu sendiri, padahal maunya nempel di kartu TM
// yang udah ada comment section-nya". Percent/resolved still reflect the transaction's CURRENT
// status either way (so the original card still correctly reaches 100% once resolved at the new
// target) — only the GROUPING key changed, from "every chain member" to "just the original".
// getPairTransactions (Dashboard-Detailing) already resolves the full chain when queried by the
// original target, so the comment thread was never actually fragmented — only the card list was.
async function buildChainAwareProgress(client, { initiatorDinas, groupBy }) {
  const whereParts = ['dinas_target IS NOT NULL', 'status_konfirmasi = ANY($1)'];
  const params = [ACTIONABLE_STATUSES];
  if (initiatorDinas) {
    whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
    params.push(initiatorDinas);
  }
  const txRes = await client.query(
    `SELECT id, dinas_inisiasi, dinas_target, status_konfirmasi, reassign_count, export_batch_id
     FROM rdt.transactions WHERE ${whereParts.join(' AND ')}`,
    params
  );
  const transactions = txRes.rows;

  const reassignedIds = transactions.filter((t) => t.reassign_count > 0).map((t) => t.id);
  const chainMap = await fetchReassignChainMap(client, reassignedIds);
  const replyCounts = await fetchReplyCounts(client, transactions.map((t) => t.id));

  // REQ-RDT-SAP-12 (31 Jul, gap found in code review): as_initiator cards are keyed by the
  // ORIGINAL target (pre-redirect), but export_batches rows are keyed by a pair's CURRENT target
  // — a card can in principle span more than one batch if some of its transactions took
  // different redirect paths. Tracked per card below (batchIds, pending count, whether any
  // resolved transaction is still unbatched) so the label reflects the true combined state
  // instead of guessing off a single mismatched key.
  const agg = {}; // key -> { dinasInisiasi, target, total, resolved, pending, declined_pending_action, reply_count, batchIds, hasUnbatchedResolved, chain, chainConsistent }
  const bump = (key, dinasInisiasi, target, status, replyCount, exportBatchId, fullChain) => {
    if (!agg[key]) agg[key] = { dinasInisiasi, target, total: 0, resolved: 0, pending: 0, declined_pending_action: 0, reply_count: 0, batchIds: new Set(), hasUnbatchedResolved: false, chain: fullChain, chainConsistent: true };
    const a = agg[key];
    const resolved = RESOLVED_STATUSES.includes(status);
    a.total += 1;
    if (resolved) a.resolved += 1;
    if (status === 'PENDING') a.pending += 1;
    if (status === 'DECLINED') a.declined_pending_action += 1;
    a.reply_count += replyCount;
    if (resolved) {
      if (exportBatchId) a.batchIds.add(exportBatchId);
      else a.hasUnbatchedResolved = true;
    }
    // REQ-RDT-NAV-03 (31 Jul, breadcrumb fix): a card can group transactions that took DIFFERENT
    // redirect paths after sharing the same original target (e.g. one went TJ->TC->TL, another
    // TJ->TC->TE) — only expose a single `chain` breadcrumb when every member transaction agrees
    // on the exact same full path; otherwise leave it undefined so the frontend falls back to the
    // plain dinas_inisiasi -> target two-point display rather than showing a misleading blend.
    if (JSON.stringify(fullChain) !== JSON.stringify(a.chain)) a.chainConsistent = false;
  };
  for (const t of transactions) {
    const replyCount = replyCounts[t.id] || 0;
    const chain = chainMap[t.id] || [];
    const originalTarget = chain.length > 0 ? chain[0] : t.dinas_target;
    const key = groupBy === 'pair' ? `${t.dinas_inisiasi} ${originalTarget}` : originalTarget;
    // Full breadcrumb this ONE transaction actually took: initiator -> every intermediate dinas it
    // was reassigned FROM (chronological, see fetchReassignChainMap) -> its current dinas_target.
    const fullChain = [t.dinas_inisiasi, ...chain, t.dinas_target];
    bump(key, t.dinas_inisiasi, originalTarget, t.status_konfirmasi, replyCount, t.export_batch_id, fullChain);
  }

  // One batched lookup for every card's contributing batches' subdoc numbers, same shape as
  // exportBatches.js's GET /history — a card whose transactions landed in more than one batch
  // (the redirect-split edge case above) shows the UNION of subdoc numbers across all of them.
  const allBatchIds = Array.from(new Set(Object.values(agg).flatMap((a) => Array.from(a.batchIds))));
  const subdocsByBatch = {};
  if (allBatchIds.length) {
    const subdocsRes = await client.query(
      `SELECT batch_id, subdoc_number FROM rdt.export_subdocs WHERE batch_id = ANY($1) ORDER BY created_at ASC, id ASC`,
      [allBatchIds]
    );
    for (const s of subdocsRes.rows) {
      if (!subdocsByBatch[s.batch_id]) subdocsByBatch[s.batch_id] = [];
      subdocsByBatch[s.batch_id].push(s.subdoc_number);
    }
  }

  // Bug fix (7 Agu, REQ-RDT-SAP-09 live-verification): this function used to have NO
  // export_batch_id filter at all — unlike GET /waiting and buildNeedToConfirmProgress below,
  // which both correctly exclude archived rows, a fully-reposted pair just sat here forever with
  // state_label "Reposted by TAB with subdoc ..." instead of disappearing into Riwayat Repost.
  // Can't fix this with a plain WHERE export_batch_id IS NULL on the query above though — the
  // hasUnbatchedResolved/batchIds tracking in bump() deliberately needs to SEE already-batched
  // rows too, to keep showing a card that's only PARTIALLY reposted (some rows batched via an
  // earlier subdoc, others newly resolved and not yet batched — the SAP-08 multi-subdoc-over-time
  // flow). So the filter has to happen here instead, after aggregation: drop a key only once it's
  // fully resolved AND every resolved row already has a batch (truly done, nothing left to ever
  // repost) — a still-partial card keeps showing exactly as before.
  const rows = Object.keys(agg)
    .filter((key) => {
      const a = agg[key];
      return !(a.total > 0 && a.total === a.resolved && !a.hasUnbatchedResolved && a.batchIds.size > 0);
    })
    .sort()
    .map((key) => {
      const a = agg[key];
      const subdocNumbers = a.hasUnbatchedResolved ? [] : Array.from(a.batchIds).flatMap((id) => subdocsByBatch[id] || []);
      const base = {
        total: a.total,
        resolved: a.resolved,
        // REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): the segmented progress bar needs PENDING
        // ("Open") as its own count, not just folded into `percent` — `resolved` already lumps
        // CONFIRMED+BORNE_BY_INITIATOR together for that computation, so this is the missing piece.
        open: a.pending,
        percent: a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
        declined_pending_action: a.declined_pending_action,
        reply_count: a.reply_count,
        state_label: deriveStateLabel({ pendingCount: a.pending, targetDinas: a.target, subdocNumbers }),
        // REQ-RDT-NAV-03 (31 Jul): full redirect breadcrumb (e.g. ['TJ','TC','TL']), only present
        // when every transaction under this card agrees on the same path — see bump()'s comment.
        chain: a.chainConsistent ? a.chain : undefined,
      };
      return groupBy === 'pair'
        ? { dinas: a.dinasInisiasi, target_dinas: a.target, ...base }
        : { dinas: a.target, ...base };
    });

  // See fetchInvestigationCounts's header comment.
  const investigationRows = await fetchInvestigationCounts(client, groupBy === 'pair' ? null : initiatorDinas);
  if (groupBy === 'pair') {
    rows.push(...investigationRows);
  } else if (investigationRows.length) {
    const r = investigationRows[0];
    rows.push({ dinas: 'INVESTIGATION', total: r.total, resolved: 0, percent: 0, declined_pending_action: 0, reply_count: r.reply_count });
  }
  return rows;
}

// "Need to Confirm" rich cards (28 Jul, Figma nodes 1:2/69:209): percent + reply count per
// pair, not just the bare dinas-code list fetchNeedToConfirmDinas returns for the sidebar badge.
// Same export-batch visibility rule as fetchNeedToConfirmDinas (stays listed until TAB confirms
// the whole dinas via POST /api/export-batches/confirm — REQ-RDT-SAP-05, 29 Jul — not just until
// PENDING hits zero: export_batch_id is only ever set at that confirm step, see
// exportBatches.js) — no chain expansion needed here (dinas_inisiasi never changes on
// reassignment, unlike dinas_target).
//
// UPDATE (28 Jul, bug report): grouping by dinas_inisiasi ALONE loses which of TAB's several
// queues (their own 'TAB', plus 'Corp' which has no dedicated PIC — REQ-RDT-AUTH-04) a
// submission actually sits in. That made "Ask TA"-targeted rows (see excelParser.js's
// NEEDS_INVESTIGATION routing) show up merged into a generic "TJ" card with no indication of
// which real queue held them, and the Confirmation page's queue picker had no way to auto-select
// the right one — reported live as "muncul di dashboard tapi ga bisa di-confirm, defaultnya salah
// antrian". Now grouped by (dinas_inisiasi, dinas_target) PAIR so every card names its real
// target and the frontend can route straight to the correct queue.
// (REQ-RDT-AUTH-05, corrected 31 Jul: dinas 'TA' itself has its own PIC and its own confirmation
// queue like any other dinas — it was mistakenly folded into TAB's staffed queues 28 Jul, fixed
// in needToConfirmTargetCodes above. Only 'Corp' genuinely has no dedicated PIC.)
// includeInvestigation (29 Jul, project owner request): NEEDS_INVESTIGATION rows need TAB
// action too ("itu bagian yang harus dikonfirmasi") — appended as pseudo-cards via
// fetchInvestigationCounts, same sentinel target_dinas='INVESTIGATION' used everywhere else on
// this page. Only ever true for the TAB call site (see /summary below) — a plain PIC's
// Need-to-Confirm view has nothing to do with investigation, that's TAB's queue alone.
async function buildNeedToConfirmProgress(client, targetDinasCodes, includeInvestigation) {
  const txRes = await client.query(
    `SELECT t.id, t.dinas_inisiasi, t.dinas_target, t.status_konfirmasi, t.reassign_count
     FROM rdt.transactions t
     WHERE UPPER(t.dinas_target) = ANY($1)
       AND t.status_konfirmasi = ANY($2)
       AND t.export_batch_id IS NULL`,
    [targetDinasCodes, ACTIONABLE_STATUSES]
  );
  const transactions = txRes.rows;
  const replyCounts = await fetchReplyCounts(client, transactions.map((t) => t.id));
  // A5 (3 Agu, chain arrow still missing everywhere except Dashboard-Detailing): this query groups
  // by the CURRENT dinas_target, unlike buildChainAwareProgress's "group by ORIGINAL target"
  // rule — but the card still needs each transaction's own intermediate hops to render a full
  // breadcrumb instead of a plain 2-point dinas_inisiasi->dinas_target label. Same
  // fetchReassignChainMap + "only expose chain when every transaction in the group agrees"
  // pattern as buildChainAwareProgress, just keyed differently.
  const reassignedIds = transactions.filter((t) => t.reassign_count > 0).map((t) => t.id);
  const chainMap = await fetchReassignChainMap(client, reassignedIds);

  const agg = {};
  for (const t of transactions) {
    const key = `${t.dinas_inisiasi} ${t.dinas_target}`;
    if (!agg[key]) agg[key] = { dinas: t.dinas_inisiasi, target_dinas: t.dinas_target, total: 0, resolved: 0, pending: 0, declined: 0, reply_count: 0, chain: undefined, chainConsistent: true, chainSeeded: false };
    const a = agg[key];
    a.total += 1;
    if (RESOLVED_STATUSES.includes(t.status_konfirmasi)) a.resolved += 1;
    if (t.status_konfirmasi === 'PENDING') a.pending += 1;
    if (t.status_konfirmasi === 'DECLINED') a.declined += 1;
    a.reply_count += replyCounts[t.id] || 0;
    const fullChain = [t.dinas_inisiasi, ...(chainMap[t.id] || []), t.dinas_target];
    if (!a.chainSeeded) { a.chain = fullChain; a.chainSeeded = true; }
    else if (JSON.stringify(fullChain) !== JSON.stringify(a.chain)) a.chainConsistent = false;
  }
  // REQ-RDT-SAP-07 state label: this query is already scoped to export_batch_id IS NULL and keyed
  // by the CURRENT dinas_target (no chain-collapsing like buildChainAwareProgress does), so it's
  // safe to derive directly here — once TAB confirms a pair, export_batch_id gets set and the row
  // falls out of this query entirely (existing 25 Jul behavior), so "Reposted with subdoc" never
  // needs to appear on this endpoint.
  const rows = Object.keys(agg).sort().map((key) => {
    const a = agg[key];
    return {
      dinas: a.dinas,
      target_dinas: a.target_dinas,
      total: a.total,
      resolved: a.resolved,
      // REQ-RDT-NAV-02 (1 Agu sore, project owner request): TAB's "Need Identification" Dashboard
      // sub-view reuses the same segmented-bar pair-card as Report Submission/Summary Progress —
      // that card reads open/declined_pending_action off the row, same fields
      // buildChainAwareProgress's rows already carry.
      open: a.pending,
      declined_pending_action: a.declined,
      percent: a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
      reply_count: a.reply_count,
      state_label: deriveStateLabel({ pendingCount: a.pending, targetDinas: a.target_dinas }),
      // A5 (3 Agu): full redirect breadcrumb, only present when every transaction under this
      // card agrees on the exact same path — same rule buildChainAwareProgress uses.
      chain: a.chainConsistent && a.chain && a.chain.length > 2 ? a.chain : undefined,
    };
  });
  if (includeInvestigation) rows.push(...(await fetchInvestigationCounts(client, null)));
  return rows;
}

// REQ-RDT-NAV-03 (Dashboard-Detailing): every transaction initiated by `initiatorDinas` whose
// CURRENT dinas_target is `targetDinas`, OR whose reassignment chain ever passed through
// `targetDinas` — same "once you're in the chain, you stay counted" rule buildChainAwareProgress
// uses for the pair's own progress numbers, so the transaction list and the percent agree.
async function getPairTransactions(client, initiatorDinas, targetDinas) {
  // REQ-RDT-LEDGER-10 (29 Jul): the sentinel target 'INVESTIGATION' has no real dinas_target to
  // chain-resolve (these rows are dinas_target IS NULL by definition, awaiting TAB's assign) —
  // a plain status filter instead of the chain logic below, so the uploading dinas (and TAB) can
  // see them in Dashboard-Detailing before they're ever routed anywhere real.
  if (String(targetDinas).toUpperCase() === 'INVESTIGATION') {
    const invRes = await client.query(
      `SELECT id, account, nominal, status_konfirmasi, ref_doc, remark, dinas_target, reassign_count
       FROM rdt.transactions WHERE dinas_inisiasi=$1 AND status_konfirmasi='NEEDS_INVESTIGATION'`,
      [initiatorDinas]
    );
    return invRes.rows;
  }
  const txRes = await client.query(
    `SELECT id, account, nominal, status_konfirmasi, ref_doc, remark, dinas_target, reassign_count
     FROM rdt.transactions WHERE dinas_inisiasi=$1 AND dinas_target IS NOT NULL AND status_konfirmasi = ANY($2)`,
    [initiatorDinas, ACTIONABLE_STATUSES]
  );
  const transactions = txRes.rows;
  const reassignedIds = transactions.filter((t) => t.reassign_count > 0).map((t) => t.id);
  const chainMap = await fetchReassignChainMap(client, reassignedIds);
  const targetUpper = String(targetDinas).toUpperCase();
  return transactions
    .filter((t) => {
      const chainDinas = new Set([t.dinas_target, ...(chainMap[t.id] || [])].map((d) => String(d).toUpperCase()));
      return chainDinas.has(targetUpper);
    })
    // REQ-RDT-NAV-03 (3 Agu, re-flagged still-open): the pair-level breadcrumb (buildChainAwareProgress's
    // `chain`) only shows when EVERY transaction in the pair agrees on the same redirect path — with
    // hundreds of transactions per pair, that's almost never true for a pair where even one row got
    // redirected, so the header falls back to the plain 2-point display, and (until now) there was
    // NOWHERE ELSE a per-transaction breadcrumb was rendered at all — Dashboard-Detailing had no
    // transaction list, just the aggregate circle. Attaching each transaction's OWN full chain here
    // (initiator -> every from_dinas hop -> current target) lets the frontend show it per-row instead.
    .map((t) => ({ ...t, chain: [initiatorDinas, ...(chainMap[t.id] || []), t.dinas_target] }));
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
    const transactions = await getPairTransactions(client, initiatorDinas, targetDinas);
    // B2 fix (3 Agu): this used to look up a pre-aggregated row from buildChainAwareProgress,
    // which groups by each transaction's ORIGINAL target — but a 'need' card (buildNeedToConfirmProgress)
    // links here using the CURRENT target, so for any pair reached via redirect the lookup found
    // no match and silently fell back to an all-zero progress object (0%, canGoToConfirm always
    // false). getPairTransactions already resolves the exact chain-inclusive set for this
    // initiator/target pair (see its header comment: "the transaction list and the percent agree"
    // — that invariant only holds if percent is computed from this same set), so aggregate
    // directly off `transactions` instead of a separately-keyed lookup.
    const total = transactions.length;
    const resolved = transactions.filter((t) => RESOLVED_STATUSES.includes(t.status_konfirmasi)).length;
    const pending = transactions.filter((t) => t.status_konfirmasi === 'PENDING').length;
    const declined = transactions.filter((t) => t.status_konfirmasi === 'DECLINED').length;
    // REQ-RDT-UI-05 "Rincian per-hop" (4 Agu): the header breadcrumb badge needs the same
    // chain-if-consistent field the Dashboard cards' progress objects carry — this endpoint built
    // its own `progress` object straight off `transactions` (see the B2 comment above) rather than
    // reusing buildChainAwareProgress, so it never picked up `chain`. Each transaction already
    // carries its own full chain (getPairTransactions), so the same "expose only when every member
    // agrees" rule applies here too.
    const chainStrings = transactions.map((t) => JSON.stringify(t.chain));
    const chainConsistent = chainStrings.length > 0 && chainStrings.every((c) => c === chainStrings[0]);
    const chain = chainConsistent && transactions[0]?.chain?.length > 2 ? transactions[0].chain : undefined;
    const progress = {
      dinas: targetDinas,
      total,
      resolved,
      open: pending,
      declined_pending_action: declined,
      percent: total > 0 ? Math.round((resolved / total) * 1000) / 10 : 0,
      chain,
    };
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
  // Checklist 1.3 (12 Agu): was trusted with no length cap — this is the most direct
  // free-text-comment endpoint of the 8, no upstream field name to disambiguate from.
  const bodyCheck = validateFreeText(req.body && req.body.body, { required: true, fieldLabel: 'body' });
  if (!bodyCheck.ok) return res.status(400).json(bodyCheck);
  const body = bodyCheck.value;
  const parentCommentId = req.body && req.body.parent_comment_id;
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
    // Privacy bug fix (4 Agu): a mention of a dinas outside THIS pair must not leak a notification
    // that reveals this pair's existence to them — see mentionRules.js's filterMentionsToPair.
    const directory = await loadDirectory();
    const mentionedUserIds = filterMentionsToPair(resolveMentionedUserIds(body, directory), directory, [initiatorDinas, targetDinas])
      .filter((id) => id !== req.rdtUser.id);
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
// CONFIRMED/BORNE, the pair should stay visible until TAB has actually confirmed that whole
// dinas pengaju (REQ-RDT-SAP-05, 29 Jul — see exportBatches.js's POST /confirm, which is the
// only place export_batch_id ever gets set now) — "jangan ilang sebelum di-confirm oleh TAB".
// So: keep any dinas_inisiasi with an ACTIONABLE row targeting me that hasn't yet been swept
// into a confirmed batch, not just PENDING ones.
//
// TAB also staffs dinas "Corp"'s queue (no dedicated PIC, REQ-RDT-AUTH-04) — its dinas_target
// rows never showed up under myDinas='TAB' before this fix.
//
// REQ-RDT-AUTH-05 (CORRECTED 31 Jul, presentation feedback): 'TA' was removed from this list.
// It was added 28 Jul on the mistaken assumption that TA had no dedicated PIC like Corp — that
// assumption was wrong. TA is its OWN operational dinas with its own PIC (see
// employee-directory.seed.json's demo-ta entry), distinct from TAB staff. Its rows belong in
// dinas TA's own confirmation queue, not bundled into TAB's.
function needToConfirmTargetCodes(myDinas, isTabStaff) {
  return (isTabStaff ? [myDinas, 'Corp'] : [myDinas]).map((d) => String(d).toUpperCase());
}

// Bare dinas-code list, no percent/reply-count aggregation — used ONLY by GET
// /need-to-confirm-count (REQ-RDT-NAV-02a's sidebar badge, called on every page load) so that
// route stays a single cheap DISTINCT query instead of paying for buildNeedToConfirmProgress's
// per-transaction reply-count join just to get a count.
async function fetchNeedToConfirmDinas(client, targetDinasCodes, includeInvestigation) {
  const res = await client.query(
    `SELECT DISTINCT t.dinas_inisiasi AS dinas
     FROM rdt.transactions t
     WHERE UPPER(t.dinas_target) = ANY($1)
       AND t.status_konfirmasi = ANY($2)
       AND t.export_batch_id IS NULL
     ORDER BY dinas`,
    [targetDinasCodes, ACTIONABLE_STATUSES]
  );
  const dinasList = res.rows.map((r) => r.dinas);
  // Same badge-count parity as buildNeedToConfirmProgress's includeInvestigation — counts as one
  // more "needs my attention" entry for TAB if there's at least one row awaiting investigation.
  if (includeInvestigation) {
    const invRes = await client.query(`SELECT 1 FROM rdt.transactions WHERE status_konfirmasi='NEEDS_INVESTIGATION' LIMIT 1`);
    if (invRes.rows.length) dinasList.push('INVESTIGATION');
  }
  return dinasList;
}

router.get('/summary', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const myDinas = req.rdtUser.dinas;
  const isTabStaff = req.rdtUser.role === 'TAB';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    const asInitiator = isTabStaff
      ? await buildChainAwareProgress(client, { initiatorDinas: null, groupBy: 'pair' })
      : await buildChainAwareProgress(client, { initiatorDinas: myDinas, groupBy: 'target' });
    // Rich per-pair cards (percent + reply count), not just the bare dinas-code list — see
    // buildNeedToConfirmProgress's header comment (Figma nodes 1:2/69:209, 28 Jul).
    const needToConfirm = await buildNeedToConfirmProgress(client, needToConfirmTargetCodes(myDinas, isTabStaff), isTabStaff);

    res.json({ ok: true, own_dinas: myDinas, as_initiator: asInitiator, need_to_confirm: needToConfirm, is_global_view: isTabStaff });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// REQ-RDT-SAP-12 (31 Jul, expanded per project owner idea): read-only repost/subdoc status for
// pairs a dinas initiated now lives at GET /api/export-batches/history (auto-scoped to the
// caller's own dinas_inisiasi for non-TAB users) rather than a second endpoint here — same table,
// same query, two viewpoints, not two implementations. Pre-confirm progress is still /summary's
// as_initiator cards (state_label-enriched, see buildChainAwareProgress above).

// REQ-RDT-NAV-02a: lightweight count-only endpoint for the sidebar "Dashboard" badge, visible
// from any page — called once at shell load, not the
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
    const needToConfirm = await fetchNeedToConfirmDinas(client, needToConfirmTargetCodes(myDinas, isTabStaff), isTabStaff);
    res.json({ ok: true, count: needToConfirm.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// "Open" = still needs SOMEONE's decision (PENDING waits on the target, DECLINED waits on the
// initiator's Tanggung Sendiri/Ajukan Ulang) — the complement of RESOLVED_STATUSES within
// ACTIONABLE_STATUSES. Not itself a pre-existing SRS term; derived here for the new KPI cards
// (REQ-RDT-NAV-02, Figma nodes 78:242/78:243, 1 Agu) which don't have a written spec beyond the
// mockup's example numbers, so these definitions are a reasonable, documented interpretation
// rather than a literal requirement — flagged for the project owner to confirm/correct if the
// exact semantics matter.
const OPEN_STATUSES = ['PENDING', 'DECLINED'];

// GET /api/dashboard/kpis — REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): the 4 summary cards atop
// a PIC's Report Submission page (own dinas_inisiasi only), or the 5 summary cards atop TAB's
// Summary Progress All Dinas page (system-wide). Role-aware response shape, same pattern as
// GET /summary above.
router.get('/kpis', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const myDinas = req.rdtUser.dinas;
  const isTabStaff = req.rdtUser.role === 'TAB';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    if (!isTabStaff) {
      const r = await client.query(
        `SELECT
           COUNT(*)::int AS total,
           COALESCE(SUM(nominal), 0)::float AS total_nilai,
           COUNT(*) FILTER (WHERE status_konfirmasi = ANY($2))::int AS open_count,
           COUNT(DISTINCT dinas_target)::int AS pasangan_count
         FROM rdt.transactions
         WHERE dinas_inisiasi = $1 AND dinas_target IS NOT NULL AND status_konfirmasi = ANY($3)`,
        [myDinas, OPEN_STATUSES, ACTIONABLE_STATUSES]
      );
      const row = r.rows[0];
      res.json({
        ok: true,
        is_global_view: false,
        total_transaksi: row.total,
        total_nilai: row.total_nilai,
        pasangan_count: row.pasangan_count,
        open_count: row.open_count,
        resolved_count: row.total - row.open_count,
      });
      return;
    }

    const [dinasAktifRes, totalRes, investigasiRes, waitingRes, repostedRes] = await Promise.all([
      client.query(`SELECT COUNT(DISTINCT dinas_inisiasi)::int AS c FROM rdt.transactions WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($1)`, [ACTIONABLE_STATUSES]),
      client.query(`SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($1)`, [ACTIONABLE_STATUSES]),
      client.query(`SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE status_konfirmasi = 'NEEDS_INVESTIGATION'`),
      // Same readiness rule as exportBatches.js's GET /waiting: every unbatched row for the pair
      // is resolved (no PENDING/DECLINED/NEEDS_REVIEW left) and at least one attachable row exists.
      client.query(
        `SELECT COUNT(*)::int AS c FROM (
           SELECT dinas_inisiasi, dinas_target
           FROM rdt.transactions
           WHERE export_batch_id IS NULL AND dinas_target IS NOT NULL
             AND status_konfirmasi = ANY($1)
           GROUP BY dinas_inisiasi, dinas_target
           HAVING COUNT(*) FILTER (WHERE status_konfirmasi = ANY($2)) = 0
              AND COUNT(*) FILTER (WHERE status_konfirmasi = ANY($3)) > 0
         ) waiting_pairs`,
        [[...OPEN_STATUSES, 'NEEDS_REVIEW'], [...OPEN_STATUSES, 'NEEDS_REVIEW'], RESOLVED_STATUSES]
      ),
      client.query(`SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE subdoc_id IS NOT NULL`),
    ]);
    res.json({
      ok: true,
      is_global_view: true,
      dinas_aktif: dinasAktifRes.rows[0].c,
      total_transaksi: totalRes.rows[0].c,
      butuh_investigasi: investigasiRes.rows[0].c,
      waiting_to_repost: waitingRes.rows[0].c,
      reposted: repostedRes.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// GET /api/dashboard/per-dinas-rollup — TAB-only. REQ-RDT-NAV-02 (Figma 78:243, "Progress per
// Dinas Pengaju"): unlike buildChainAwareProgress's groupBy:'pair' (one row per (initiator,
// target) pair), this sums ALL of one dinas_inisiasi's pairs into a single row — the table this
// page shows is "how is each SUBMITTING dinas doing overall", not per-pair detail (that's still
// available via the pair cards / Dashboard-Detailing). Sorted by Open descending (Figma's own
// stated sort), matching the page's "worst first" triage intent.
router.get('/per-dinas-rollup', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT dinas_inisiasi AS dinas,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status_konfirmasi = ANY($1))::int AS confirmed,
              COUNT(*) FILTER (WHERE status_konfirmasi = 'PENDING')::int AS open,
              COUNT(*) FILTER (WHERE status_konfirmasi = 'DECLINED')::int AS declined
       FROM rdt.transactions
       WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($2)
       GROUP BY dinas_inisiasi
       ORDER BY open DESC, dinas_inisiasi ASC`,
      [RESOLVED_STATUSES, ACTIONABLE_STATUSES]
    );
    const dinasList = r.rows.map((row) => row.dinas);
    const investigasiRes = dinasList.length
      ? await client.query(
          `SELECT dinas_inisiasi AS dinas, COUNT(*)::int AS c FROM rdt.transactions
           WHERE status_konfirmasi = 'NEEDS_INVESTIGATION' AND dinas_inisiasi = ANY($1)
           GROUP BY dinas_inisiasi`,
          [dinasList]
        )
      : { rows: [] };
    const investigasiByDinas = {};
    investigasiRes.rows.forEach((row) => { investigasiByDinas[row.dinas] = row.c; });

    // Status pill: "Butuh Investigasi (N)" wins if this dinas has any NEEDS_INVESTIGATION rows
    // (TAB needs to act regardless of how the rest of the dinas's pairs are doing); "Semua
    // reposted" only once every row is resolved AND (see per-row check below) already has a
    // subdoc — a 100%-resolved dinas that TAB hasn't reposted yet stays unbadged rather than
    // claiming "reposted" prematurely.
    //
    // Bug fix (7 Agu): the two branches above were the ONLY cases that ever set `status` — every
    // other row (the common case: a dinas with pairs still PENDING/DECLINED) fell through to
    // `null`, and the template only renders the pill `*ngIf="row.status"` — so "Status" read empty
    // for basically every row in practice. Added the two branches below to cover the rest of
    // REQ-RDT-SAP-07's three-state vocabulary (rules/stateLabel.js's deriveStateLabel), rolled up
    // to dinas level instead of one target: `open` (PENDING) rows mean someone's still waiting on
    // a confirmation, same as deriveStateLabel's own first branch; everything else that isn't
    // "Semua reposted" yet (including a 100%-confirmed-but-not-reposted dinas, AND a dinas whose
    // only outstanding rows are DECLINED with none PENDING) falls to "Waiting to repost" — mirrors
    // deriveStateLabel's own fallback branch exactly, same DECLINED-counts-as-basically-done
    // quirk that's already established at every pair-level call site (exportBatches.js's
    // GET /waiting, buildNeedToConfirmProgress) — not something to invent new wording for here.
    const rows = await Promise.all(r.rows.map(async (row) => {
      const total = row.total;
      const percent = total > 0 ? Math.round((row.confirmed / total) * 1000) / 10 : 0;
      const investigationCount = investigasiByDinas[row.dinas] || 0;
      let status = null;
      if (investigationCount > 0) {
        status = { kind: 'investigation', label: `Butuh Investigasi (${investigationCount})` };
      } else if (row.open > 0) {
        status = { kind: 'pending', label: 'Waiting for confirmation' };
      } else if (total > 0) {
        const unrepostedRes = await client.query(
          `SELECT COUNT(*)::int AS c FROM rdt.transactions
           WHERE dinas_inisiasi = $1 AND status_konfirmasi = ANY($2) AND subdoc_id IS NULL`,
          [row.dinas, RESOLVED_STATUSES]
        );
        status = unrepostedRes.rows[0].c === 0
          ? { kind: 'reposted', label: 'Semua reposted' }
          : { kind: 'waiting-repost', label: 'Waiting to repost' };
      }
      return { dinas: row.dinas, total, confirmed: row.confirmed, open: row.open, declined: row.declined, percent, status };
    }));
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// GET /api/dashboard/summary/:dinasInisiasi/breakdown — TAB-only. REQ-RDT-SAP-15 (8 Agu, senior
// TAB feedback): the per-dinas rollup table above sums ALL of a dinas_inisiasi's pairs into one
// row — TAB asked for a way to see the pecahan (breakdown) per pasangan (dinas_target) behind
// that one row, e.g. TJ=487 total/87 open could be TJ→TA, TJ→TE, TJ→TMM each with their own
// progress. Full reuse of buildChainAwareProgress's groupBy:'pair' shape (same one /summary uses
// for TAB's global as_initiator view) — just scoped to ONE dinas_inisiasi via the initiatorDinas
// filter, and NOT re-aggregated: returns the array of per-pair rows as-is.
//
// The one wrinkle: buildChainAwareProgress's groupBy:'pair' branch always fetches investigation
// rows GLOBALLY (fetchInvestigationCounts(client, null), see its own comment) rather than scoped
// to initiatorDinas — reusing it unfiltered here would leak every OTHER dinas's Investigation
// pseudo-card into this one dinas's breakdown. Filtered back down to this dinas below rather than
// touching buildChainAwareProgress itself, since its global-scope behavior is still correct for
// /summary's own call site.
router.get('/summary/:dinasInisiasi/breakdown', requireRole('TAB'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });
  const { dinasInisiasi } = req.params;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const pairs = (await buildChainAwareProgress(client, { initiatorDinas: dinasInisiasi, groupBy: 'pair' }))
      .filter((r) => String(r.dinas).toUpperCase() === String(dinasInisiasi).toUpperCase());
    res.json({ ok: true, dinas_inisiasi: dinasInisiasi, pairs });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

module.exports = router;
