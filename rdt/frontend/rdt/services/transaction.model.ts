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
