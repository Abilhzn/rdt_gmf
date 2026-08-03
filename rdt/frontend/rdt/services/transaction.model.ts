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
  /** REQ-RDT-NAV-04 (1 Agu, diperjelas): the file's real "Sub Group" column, raw — NOT derived,
   * and independent of `category` (which may ALSO read this same column as a GL fallback for
   * dinas whose sheet has no literal "GL" column — see excelParser.js's buildDetailRow). null
   * for any dinas whose sheet has no "Sub Group" column at all (e.g. TB). */
  sub_group?: string | number | null;
  /** REQ-RDT-EXT-09 point 3: 'DETAIL_ROW' = a real individual transaction line; 'PIVOT_DERIVED' =
   * a synthetic one-row-per-pivot-cell aggregate (no per-row document/cost-center/Sub Group data
   * exists at all for these — that's expected, not a mapping bug, see repost-budgeting.component
   * .html's granularity badge). */
  granularity?: 'DETAIL_ROW' | 'PIVOT_DERIVED';
  /** REQ-RDT-NAV-04 (31 Jul, presentation feedback): free-text note a reviewer can attach to a
   * row while still on the Review-before-upload step. FRONTEND-ONLY, deliberately not sent to
   * POST /api/persist — SRS flags where this should ultimately be stored as still open (a new
   * rdt.transactions column, or somewhere else) and explicitly says not to guess/migrate until
   * the project owner confirms. Lives only as long as this review session (repost-budgeting.
   * component.ts's commit()/reset() strip or clear it). */
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
