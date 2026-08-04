// REQ-RDT-EXT-10 — decides what happens to a dinas's PREVIOUS upload's transactions when a new
// upload lands for the same (dinas_inisiasi, periode).
//
// The block-vs-supersede call is a FACT check, not a guessed status whitelist (project owner
// correction, 4 Agu, after an earlier draft of this logic proposed hardcoding which
// status_konfirmasi values count as "already decided"): a transaction has real money moved for it
// if and only if rdt.ledger_entries has a row for it (only routes/confirmation.js's CONFIRMED path
// ever writes one — verified directly in code; BORNE_BY_INITIATOR is a pure status change with no
// ledger_entries row, per reassignment.js's own header comment). So:
//   - ANY old-upload transaction with a ledger_entries row -> BLOCK the whole supersede, report to
//     the project owner, touch nothing (that's a financial commitment already made).
//   - Otherwise, every old-upload transaction WITHOUT one is safe to flip to SUPERSEDED -- except
//     rows already sitting in a terminal, already-inert status (EXCLUDED/INVALID/SPLIT_VOID) that
//     no active-aggregation query has ever counted anyway; rewriting those would only destroy their
//     original diagnostic status for zero behavioral change, so they're left alone.

const ALREADY_INERT_STATUSES = ['EXCLUDED', 'INVALID', 'SPLIT_VOID'];

// oldUploadTransactions: array of { id, status_konfirmasi, has_ledger_entry }
function evaluateSupersede(oldUploadTransactions) {
  const blocking = oldUploadTransactions.filter((t) => t.has_ledger_entry);
  if (blocking.length > 0) {
    return {
      blocked: true,
      blockingCount: blocking.length,
      blockingIds: blocking.map((t) => t.id),
      supersedeIds: [],
    };
  }
  const supersedeIds = oldUploadTransactions
    .filter((t) => !ALREADY_INERT_STATUSES.includes(t.status_konfirmasi))
    .map((t) => t.id);
  return { blocked: false, blockingCount: 0, blockingIds: [], supersedeIds };
}

module.exports = { evaluateSupersede, ALREADY_INERT_STATUSES };
