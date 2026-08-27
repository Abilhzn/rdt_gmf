// Decides what happens to a dinas's PREVIOUS upload's transactions when a new upload lands for
// the same (dinas_inisiasi, periode). The block-vs-supersede call is a FACT check, not a status
// whitelist: a transaction has real money moved for it iff rdt.ledger_entries has a row for it
// (only the CONFIRMED path writes one; BORNE_BY_INITIATOR is a pure status change with none). So:
//   - ANY old-upload transaction with a ledger_entries row -> BLOCK the whole supersede, touch
//     nothing (that's a financial commitment already made).
//   - Otherwise every transaction WITHOUT one is safe to flip to SUPERSEDED -- except rows already
//     in a terminal, inert status (EXCLUDED/INVALID/SPLIT_VOID), which are left alone since no
//     active-aggregation query counts them anyway.
//
// Port 1:1 dari backend/src/persist/supersedeCheck.js.

export const ALREADY_INERT_STATUSES = ['EXCLUDED', 'INVALID', 'SPLIT_VOID'];

export interface SupersedeCandidateRow {
  id: number;
  status_konfirmasi: string;
  has_ledger_entry: boolean;
}

export interface SupersedeResult {
  blocked: boolean;
  blockingCount: number;
  blockingIds: number[];
  supersedeIds: number[];
}

export function evaluateSupersede(
  oldUploadTransactions: SupersedeCandidateRow[],
): SupersedeResult {
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
