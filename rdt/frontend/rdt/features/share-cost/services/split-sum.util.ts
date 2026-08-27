// Cent-integer comparison, matching backend share-cost.service.ts's SUM check exactly (each row
// rounded to cents individually, then summed as integers) — a naive float sum-then-round-the-diff
// disagrees with the backend on half-cent splits (e.g. 33.335 + 33.335 + 33.33 vs original 100:
// client said valid, server rejected with SPLIT_SUM_MISMATCH). Returns the diff in cents so 0
// means "matches". Kept in its own file (no @angular/core import) so it — and its test — don't
// drag in AOT template compilation of SplitFormComponent.
export function splitSumDiffCents(rows: { nominal: number | null }[], originalNominal: number | null): number {
  if (originalNominal === null) return 0;
  const sumCents = rows.reduce((acc, r) => acc + Math.round((r.nominal || 0) * 100), 0);
  const originalCents = Math.round(originalNominal * 100);
  return sumCents - originalCents;
}
