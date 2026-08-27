import { evaluateSupersede } from './supersede-check';

test('no prior upload transactions -> no-op', () => {
  const out = evaluateSupersede([]);
  expect(out.blocked).toBe(false);
  expect(out.supersedeIds).toEqual([]);
});

test('all-PENDING prior upload -> every row superseded, nothing blocked', () => {
  const rows = [
    { id: 1, status_konfirmasi: 'PENDING', has_ledger_entry: false },
    { id: 2, status_konfirmasi: 'PENDING', has_ledger_entry: false },
  ];
  const out = evaluateSupersede(rows);
  expect(out.blocked).toBe(false);
  expect(out.supersedeIds.sort()).toEqual([1, 2]);
});

test('a single row with a ledger_entries row blocks the WHOLE operation, even alongside PENDING rows', () => {
  const rows = [
    { id: 1, status_konfirmasi: 'PENDING', has_ledger_entry: false },
    { id: 2, status_konfirmasi: 'CONFIRMED', has_ledger_entry: true },
  ];
  const out = evaluateSupersede(rows);
  expect(out.blocked).toBe(true);
  expect(out.blockingCount).toBe(1);
  expect(out.blockingIds).toEqual([2]);
  expect(out.supersedeIds).toEqual([]);
});

test('the block decision is based on has_ledger_entry, NOT the status string -- a CONFIRMED row with no ledger row (should never happen in practice) does not block', () => {
  const rows = [
    { id: 1, status_konfirmasi: 'CONFIRMED', has_ledger_entry: false },
  ];
  const out = evaluateSupersede(rows);
  expect(out.blocked).toBe(false);
  expect(out.supersedeIds).toEqual([1]);
});

test('DECLINED/BORNE_BY_INITIATOR/NEEDS_REVIEW/NEEDS_INVESTIGATION with no ledger row are superseded like PENDING (BORNE_BY_INITIATOR never writes ledger_entries)', () => {
  const rows = [
    { id: 1, status_konfirmasi: 'DECLINED', has_ledger_entry: false },
    { id: 2, status_konfirmasi: 'BORNE_BY_INITIATOR', has_ledger_entry: false },
    { id: 3, status_konfirmasi: 'NEEDS_REVIEW', has_ledger_entry: false },
    {
      id: 4,
      status_konfirmasi: 'NEEDS_INVESTIGATION',
      has_ledger_entry: false,
    },
  ];
  const out = evaluateSupersede(rows);
  expect(out.blocked).toBe(false);
  expect(out.supersedeIds.sort()).toEqual([1, 2, 3, 4]);
});

test('already-inert EXCLUDED/INVALID/SPLIT_VOID rows are left out of the flip (no ledger row, but nothing to gain from rewriting them)', () => {
  const rows = [
    { id: 1, status_konfirmasi: 'EXCLUDED', has_ledger_entry: false },
    { id: 2, status_konfirmasi: 'INVALID', has_ledger_entry: false },
    { id: 3, status_konfirmasi: 'SPLIT_VOID', has_ledger_entry: false },
    { id: 4, status_konfirmasi: 'PENDING', has_ledger_entry: false },
  ];
  const out = evaluateSupersede(rows);
  expect(out.blocked).toBe(false);
  expect(out.supersedeIds).toEqual([4]);
});
