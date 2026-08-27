import { splitSumDiffCents } from './split-sum.util';

/** Locks the SUM validation against the exact cent-integer comparison backend
 * share-cost.service.ts uses (round each row to cents, sum as integers, compare to
 * round(original * 100)) — not a naive float sum + round-the-diff, which disagrees with
 * the backend on half-cent splits and would let the client say "valid" for a split the
 * server then rejects with SPLIT_SUM_MISMATCH. Tests the extracted pure function directly
 * (not the component/template) so this doesn't need Angular's AOT compiler. */
describe('splitSumDiffCents', () => {
  it('is 0 when split rows sum exactly to the original', () => {
    expect(splitSumDiffCents([{ nominal: 60 }, { nominal: 40 }], 100)).toBe(0);
  });

  it('is negative (in cents) when the sum is short', () => {
    expect(splitSumDiffCents([{ nominal: 60 }, { nominal: 39 }], 100)).toBe(-100);
  });

  it('is positive (in cents) when the sum overshoots', () => {
    expect(splitSumDiffCents([{ nominal: 60 }, { nominal: 41 }], 100)).toBe(100);
  });

  it('is 0 on clean 2-decimal splits', () => {
    expect(splitSumDiffCents([{ nominal: 33.33 }, { nominal: 33.33 }, { nominal: 33.34 }], 100)).toBe(0);
  });

  it('rejects half-cent splits the same way the backend does (cent-rounded, not naive float sum)', () => {
    // 33.335 + 33.335 + 33.33 sums to ~100 with plain float addition — a naive frontend
    // check would call this valid, but the backend rounds each row to cents first
    // (3334 + 3334 + 3333 = 10001 cents = 100.01) and rejects it against 100.00.
    expect(splitSumDiffCents([{ nominal: 33.335 }, { nominal: 33.335 }, { nominal: 33.33 }], 100)).not.toBe(0);
  });

  it('treats blank (null) rows as 0 without throwing', () => {
    expect(splitSumDiffCents([{ nominal: null }, { nominal: null }], 0)).toBe(0);
  });

  it('is 0 when there is no original nominal to compare against yet', () => {
    expect(splitSumDiffCents([{ nominal: 10 }], null)).toBe(0);
  });
});
