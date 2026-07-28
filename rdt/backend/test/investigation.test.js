const path = require('path');
const { parseExcelFile } = require('../src/parser/excelParser');
const mappingSeed = require('../src/config/mapping.seed.json');

jest.setTimeout(300000);

// REQ-RDT-LEDGER-10 (27 Jul): "Ask TA" is not a dinas — it's a signal that a row's ownership is
// ambiguous and needs manual TAB investigation (routes/investigation.js) before a real
// dinas_target can be assigned, distinct from NEEDS_REVIEW's "unmapped code" bucket. Verified
// against contoh_input/06. DT TJ JUN 2026 R1.xlsx's 3 real "Ask TA" rows (Review TJ fallback,
// Remarks empty on all of them) — same rows previously folded into the TA bucket before this
// requirement (see parser.test.js's R1 tests, updated alongside this file for the split).
test('rows whose dinas signal is the exact literal "Ask TA" get NEEDS_INVESTIGATION, not NEEDS_REVIEW or PENDING', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TJ JUN 2026 R1.xlsx');
  const results = await parseExcelFile(file, { uploaderDinas: 'TJ' });
  const mainSheetRows = results.filter((r) => r.sheet === 'DT TJ JUN 2026 R1');

  const round2 = (n) => Math.round(n * 100) / 100;
  const investigationRows = mainSheetRows.filter((r) => r.status_konfirmasi === 'NEEDS_INVESTIGATION');

  expect(investigationRows.length).toBe(3);
  expect(round2(investigationRows.reduce((s, r) => s + Number(r.nominal || 0), 0))).toBeCloseTo(40393.29, 2);
  // TAB hasn't assigned a real dinas yet — that only happens via POST /api/investigation/:id/assign.
  expect(investigationRows.every((r) => !r.dinas_target)).toBe(true);
  expect(mainSheetRows.some((r) => r.status_konfirmasi === 'NEEDS_REVIEW')).toBe(false);
});

// mapping.seed.json must never resolve "Ask TA" to a dinas again — that was the 25/28 Jul
// behavior this requirement explicitly supersedes.
test('mapping.seed.json no longer maps "Ask TA" to any dinas', () => {
  expect(mappingSeed['Ask TA']).toBeUndefined();
});
