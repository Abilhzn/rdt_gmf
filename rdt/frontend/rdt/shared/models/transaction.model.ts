// Full `rdt.transactions.status_konfirmasi` value set — CHECK constraint in
// `rdt/backend/sql/migrations/013_upload_supersede.sql` (latest ALTER, supersedes 004's
// list). SPLIT_VOID/SUPERSEDED are deliberately excluded from every active-transaction query
// backend-side (dashboard/confirmation/investigation), so the UI won't normally render them, but
// they're kept here for type completeness. NOTE: INVALID is still real (nominal unreadable at
// parse time, `excel-parser.service.ts`'s `resolveStatus`) — do not drop it.
export type TransactionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'BORNE_BY_INITIATOR'
  | 'EXCLUDED'
  | 'INVALID'
  | 'NEEDS_REVIEW'
  | 'NEEDS_INVESTIGATION'
  | 'SPLIT_VOID'
  | 'SUPERSEDED';

/** One row as returned by `POST repost/upload/parse` (`DetailRow`, Format CBO — 12 raw columns +
 * derived fields) and as sent back on `POST repost/persist` (same shape + `reviewer_note`, the
 * one field the Review-before-upload step adds client-side). */
export interface Transaction {
  sheet?: string | null;
  row?: number | null;
  dinas_inisiasi?: string | null;
  dinas_target?: string | null;
  account?: unknown;
  profit_ctr?: unknown;
  ref_doc?: unknown;
  period?: unknown;
  text_desc?: unknown;
  material?: unknown;
  in_pclc?: unknown;
  curr?: unknown;
  nominal: number | null;
  remark?: unknown;
  category?: unknown;
  reason_if_invalid?: string | null;
  status_konfirmasi: TransactionStatus;
  raw_payload?: Record<string, unknown>;
  /** Free-text note a reviewer can attach to a row while still on the Review-before-upload step —
   * a real rdt.transactions column (migration 015), and Confirmation's sticky "Notes" column
   * reads this same field. */
  reviewer_note?: string;
}

/** Agregasi: { [category]: { [dinasTarget]: total } } — bentuknya sama dengan pivot Excel dinas.
 * Backend's `parse` response only returns a flat status/dinas recap (no category breakdown), so
 * this is built client-side from `rows` (see `buildAggregation` in repost.service.ts). */
export type AggregationMatrix = Record<string, Record<string, number>>;
