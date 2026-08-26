// Classifies a caught error into konflik konkurensi / data tidak valid / koneksi terputus from its
// Postgres/Node error code, so ledger-mutating routes can report a useful category on ROLLBACK
// and log it consistently. Pure function, no DB/Express dependency.

export const CATEGORY = {
  CONCURRENCY_CONFLICT: 'KONFLIK_KONKURENSI',
  INVALID_DATA: 'DATA_TIDAK_VALID',
  CONNECTION_LOST: 'KONEKSI_TERPUTUS',
  OTHER: 'LAINNYA',
} as const;

export type ErrorCategory = (typeof CATEGORY)[keyof typeof CATEGORY];

// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
// 40001 serialization_failure, 40P01 deadlock_detected, 55P03 lock_not_available — all genuine
// "someone else touched this row/resource at the same time" conditions.
const CONCURRENCY_CODES = new Set(['40001', '40P01', '55P03']);
// Class 23 (integrity_constraint_violation: not_null/foreign_key/unique/check) — bad/conflicting
// data, not a timing issue.
function isConstraintViolation(code: unknown): boolean {
  return typeof code === 'string' && code.startsWith('23');
}
// Node network-level errors (pg client itself can throw these before even getting a PG code) and
// pg's own "Client has already been connected"/timeout messages.
const CONNECTION_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
]);

export function classifyError(err: unknown): ErrorCategory {
  if (!err) return CATEGORY.OTHER;
  const pgCode = (err as { code?: unknown }).code; // pg sets this to the Postgres SQLSTATE, or a Node error code for network failures
  if (CONCURRENCY_CODES.has(pgCode as string))
    return CATEGORY.CONCURRENCY_CONFLICT;
  if (isConstraintViolation(pgCode)) return CATEGORY.INVALID_DATA;
  if (CONNECTION_NODE_CODES.has(pgCode as string))
    return CATEGORY.CONNECTION_LOST;
  const rawMessage = (err as { message?: unknown }).message;
  const message =
    typeof rawMessage === 'string'
      ? rawMessage
      : typeof err === 'string'
        ? err
        : '';
  if (/timeout|connection|ECONNREFUSED|ECONNRESET/i.test(message))
    return CATEGORY.CONNECTION_LOST;
  if (
    /not pending|not found|mismatch|invalid|required|not eligible/i.test(
      message,
    )
  )
    return CATEGORY.INVALID_DATA;
  return CATEGORY.OTHER;
}
