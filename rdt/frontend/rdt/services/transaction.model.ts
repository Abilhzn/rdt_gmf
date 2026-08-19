export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'BORNE_BY_INITIATOR' | 'EXCLUDED' | 'INVALID' | 'NEEDS_REVIEW';

export interface Transaction {
  id?: string;
  sheet?: string;
  row?: number;
  dinas_inisiasi?: string;
  dinas_target?: string;
  nominal: number | null;
  status_konfirmasi: TransactionStatus;
  account?: string;
  ref_doc?: string;
  cost_ctr?: string;
  profit_ctr?: string;
  value_date?: string | Date;
  remark?: string;
  category?: string;
  invalid_reason?: string;
  reason_if_invalid?: string;
  raw_payload?: Record<string, any>;
  /** The file's real "Sub Group" column, raw — NOT derived, and independent of `category` (which
   * may ALSO read this same column as a GL fallback for dinas whose sheet has no literal "GL"
   * column). null for any dinas whose sheet has no "Sub Group" column at all (e.g. TB). */
  sub_group?: string | number | null;
  /** 'DETAIL_ROW' = a real individual transaction line; 'PIVOT_DERIVED' = a synthetic
   * one-row-per-pivot-cell aggregate (no per-row document/cost-center/Sub Group data exists at
   * all for these — expected, not a mapping bug, see repost-budgeting.component.html's
   * granularity badge). */
  granularity?: 'DETAIL_ROW' | 'PIVOT_DERIVED';
  /** Free-text note a reviewer can attach to a row while still on the Review-before-upload step —
   * a real rdt.transactions column, and Confirmation's sticky "Notes" column reads this same
   * field. */
  reviewer_note?: string;
}

/** Agregasi: { [category]: { [dinasTarget]: total } } — bentuknya sama dengan pivot Excel dinas */
export type AggregationMatrix = Record<string, Record<string, number>>;

export interface ParseResponse {
  ok: boolean;
  rows: Transaction[];
  aggregation: AggregationMatrix;
  error?: string;
}

export interface CommitResponse {
  ok: boolean;
  file?: string;
  inserted?: number;
  fallback?: boolean;
  error?: string;
}
