import { matchesAllColumnFilters, matchesAnyFilterValue, parseMultiValueFilter } from './multi-value-filter.component';

describe('parseMultiValueFilter', () => {
  it('splits on newline and comma, trims, drops empties, dedupes', () => {
    expect(parseMultiValueFilter('  A1 , A1\nB2\n\nC3 ,')).toEqual(['A1', 'B2', 'C3']);
  });

  it('returns [] for empty/blank input', () => {
    expect(parseMultiValueFilter('')).toEqual([]);
    expect(parseMultiValueFilter('   \n  ')).toEqual([]);
  });
});

describe('matchesAnyFilterValue', () => {
  it('passes everything when no filter values are active', () => {
    expect(matchesAnyFilterValue('anything', [])).toBe(true);
    expect(matchesAnyFilterValue(null, [])).toBe(true);
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(matchesAnyFilterValue(' a1 ', ['A1'])).toBe(true);
    expect(matchesAnyFilterValue('a1', [' a1 '])).toBe(true);
  });

  it('is exact-match, not substring', () => {
    expect(matchesAnyFilterValue('A10', ['A1'])).toBe(false);
  });

  it('treats null/undefined cell values as empty string', () => {
    expect(matchesAnyFilterValue(null, [''])).toBe(true);
    expect(matchesAnyFilterValue(undefined, ['X'])).toBe(false);
  });

  it('matches numeric cell values against string filter values', () => {
    expect(matchesAnyFilterValue(123, ['123'])).toBe(true);
  });
});

describe('matchesAllColumnFilters', () => {
  interface Row {
    account: string;
    dinas: string;
  }
  const getCellValue = (row: Row, key: string) => (row as unknown as Record<string, string>)[key];

  it('passes a row when there are no active filters at all', () => {
    const row: Row = { account: 'X1', dinas: 'TAB' };
    expect(matchesAllColumnFilters(row, {}, getCellValue)).toBe(true);
  });

  it('ignores columns with an empty filter list', () => {
    const row: Row = { account: 'X1', dinas: 'TAB' };
    expect(matchesAllColumnFilters(row, { account: [], dinas: [] }, getCellValue)).toBe(true);
  });

  it('requires ALL active-column filters to match (AND across columns)', () => {
    const row: Row = { account: 'X1', dinas: 'TAB' };
    expect(matchesAllColumnFilters(row, { account: ['X1'], dinas: ['TAB'] }, getCellValue)).toBe(true);
    expect(matchesAllColumnFilters(row, { account: ['X1'], dinas: ['PIC'] }, getCellValue)).toBe(false);
  });

  it('matches ANY value within one column filter (OR within a column)', () => {
    const row: Row = { account: 'X1', dinas: 'TAB' };
    expect(matchesAllColumnFilters(row, { account: ['X9', 'X1'] }, getCellValue)).toBe(true);
    expect(matchesAllColumnFilters(row, { account: ['X9', 'X2'] }, getCellValue)).toBe(false);
  });
});
