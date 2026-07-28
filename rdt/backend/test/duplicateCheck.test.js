const { naturalKeyOf, flagDuplicates } = require('../src/persist/duplicateCheck');

test('naturalKeyOf treats missing fields consistently (null/undefined/empty string equal)', () => {
  const a = { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: null, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC' };
  const b = { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: undefined, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC' };
  const c = { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: '', profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC' };
  expect(naturalKeyOf(a)).toBe(naturalKeyOf(b));
  expect(naturalKeyOf(b)).toBe(naturalKeyOf(c));
});

test('flagDuplicates downgrades a PENDING row to NEEDS_REVIEW when it matches a previously-persisted transaction (cross-upload duplicate)', () => {
  // real case observed in contoh_input/06. DT TB - Jun 2026.xlsx, Material sheet row 106
  const incoming = [
    { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: null, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC', status_konfirmasi: 'PENDING' },
  ];
  const existing = [
    { id: 42, upload_id: 7, document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: null, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC' },
  ];
  const out = flagDuplicates(incoming, existing);
  expect(out[0].status_konfirmasi).toBe('NEEDS_REVIEW');
  expect(out[0].reason_if_invalid).toMatch(/duplikat/i);
  expect(out[0].reason_if_invalid).toMatch(/id=42/);
});

test('flagDuplicates does NOT flag two legitimate same-document rows within a single new upload (no prior history)', () => {
  // real case: Material sheet rows 106-107 in the TB fixture — same document/ref/account/amount,
  // a legitimate partial-quantity split, both must stay PENDING since neither exists in history yet.
  const incoming = [
    { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: null, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC', status_konfirmasi: 'PENDING' },
    { document_no: '31355341', ref_doc: '4910964834', account: '40011000', cost_ctr: null, profit_ctr: 'ZGMFTBO', item: '000000', in_pclc: 327, dinas_target: 'TC', status_konfirmasi: 'PENDING' },
  ];
  const out = flagDuplicates(incoming, []);
  expect(out[0].status_konfirmasi).toBe('PENDING');
  expect(out[1].status_konfirmasi).toBe('PENDING');
});

test('flagDuplicates leaves EXCLUDED/INVALID/NEEDS_REVIEW rows untouched even if they match history', () => {
  const incoming = [
    { document_no: 'D1', ref_doc: 'R1', account: 'A1', cost_ctr: null, profit_ctr: 'P1', item: 'I1', in_pclc: 100, dinas_target: 'TC', status_konfirmasi: 'EXCLUDED' },
    { document_no: 'D1', ref_doc: 'R1', account: 'A1', cost_ctr: null, profit_ctr: 'P1', item: 'I1', in_pclc: 100, dinas_target: 'TC', status_konfirmasi: 'INVALID' },
  ];
  const existing = [
    { id: 1, upload_id: 1, document_no: 'D1', ref_doc: 'R1', account: 'A1', cost_ctr: null, profit_ctr: 'P1', item: 'I1', in_pclc: 100, dinas_target: 'TC' },
  ];
  const out = flagDuplicates(incoming, existing);
  expect(out[0].status_konfirmasi).toBe('EXCLUDED');
  expect(out[1].status_konfirmasi).toBe('INVALID');
});
