const path = require('path');
const { parseExcelFile } = require('../src/parser/excelParser');

jest.setTimeout(300000);

function pendingByTarget(rows) {
  const out = {};
  rows.filter((r) => r.status_konfirmasi === 'PENDING').forEach((r) => {
    out[r.dinas_target] = Math.round(((out[r.dinas_target] || 0) + Number(r.nominal || 0)) * 100) / 100;
  });
  return out;
}

// Rewritten 20 Agu for the Format CBO-only parser (SRS.md "TERJAWAB 15 Agu"): dinas_target now
// comes straight from the Recipient column, no more Remarks-prefix/pivot/pivot-cache machinery.
// contoh_input/06. DT TB - Jun 2026.xlsx now carries the file's real detail data on its NEW
// "DT TB - June 2026" sheet (Format CBO shape) — the old 63-column "Material" sheet is still in
// the workbook (kept for reference) but the parser correctly ignores it (no Recipient column).
// Per-dinas totals below are the exact same underlying data as the old Remarks-routed parser
// produced (cross-checked against its GL-category breakdown: TC 85312.21+9420=94732.21, Corp
// 3038.48+256.47=3294.95, TF/TJ/TL/TN unchanged) — same numbers, simpler derivation.
test('TB Format CBO sheet: dinas_target read directly from Recipient, all rows PENDING', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TB - Jun 2026.xlsx');
  const rows = await parseExcelFile(file, { uploaderDinas: 'TB' });
  expect(rows.length).toBe(469);
  expect(rows.every((r) => r.status_konfirmasi === 'PENDING')).toBe(true);
  expect(pendingByTarget(rows)).toEqual({
    TC: 94732.21, TF: 360.21, TJ: 46353.37, TL: 112867.35, TN: 860.64, Corp: 3294.95,
  });
});

// TJ's Format CBO file: same 3 real "Ask TA" rows this app has tracked since REQ-RDT-LEDGER-10
// (see investigation.test.js), now signaled via Recipient="Ask TA" instead of the old Review-
// column fallback — same NEEDS_INVESTIGATION outcome, simpler path to it.
test('TJ Format CBO sheet: "Ask TA" Recipient gets NEEDS_INVESTIGATION, rest resolve to real dinas', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TJ - Jun 2026.xlsx');
  const rows = await parseExcelFile(file, { uploaderDinas: 'TJ' });
  expect(rows.length).toBe(490);
  expect(pendingByTarget(rows)).toEqual({ TE: 84.36, TMM: 473933.51, TA: 1653.24 });
  const investigationRows = rows.filter((r) => r.status_konfirmasi === 'NEEDS_INVESTIGATION');
  expect(investigationRows.length).toBe(3);
  expect(Math.round(investigationRows.reduce((s, r) => s + Number(r.nominal || 0), 0) * 100) / 100).toBeCloseTo(40393.29, 2);
  expect(investigationRows.every((r) => !r.dinas_target)).toBe(true);
  expect(rows.some((r) => r.status_konfirmasi === 'NEEDS_REVIEW')).toBe(false);
});

// No real contoh_input file happens to contain an unresolvable Recipient or a self-repost row —
// build a tiny workbook on disk (parseExcelFile reads a real file, not a buffer) instead of
// relying on a committed fixture just for these edge cases.
async function buildFormatCboWorkbook(dataRows) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Format CBO');
  ws.addRow(['Requester', 'Account', 'Detail Group', 'Profit Ctr', 'Ref.Doc.', 'Period', 'Text', 'Material', 'In PCLC', 'Curr.', 'Remarks', 'Recipient']);
  dataRows.forEach((r) => ws.addRow(r));
  const tmpPath = path.join(require('os').tmpdir(), `parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(tmpPath);
  return tmpPath;
}

// A Recipient value that isn't "Ask TA" and isn't a known dinas code (mapping.seed.json alias or
// dinas.codes.json roster entry) must surface as NEEDS_REVIEW, not silently misroute or default to
// PENDING with no dinas_target.
test('unrecognized Recipient value gets NEEDS_REVIEW with an explanatory reason', async () => {
  const tmpPath = await buildFormatCboWorkbook([
    ['TC', '40021005', 'Expendable-Material', 'ZGMFTCW', '1900099001', '006', 'test', '', 100, 'USD', '', 'NOTADINAS'],
  ]);
  const parsed = await parseExcelFile(tmpPath, { uploaderDinas: 'TC' });
  require('fs').unlinkSync(tmpPath);

  expect(parsed.length).toBe(1);
  expect(parsed[0].status_konfirmasi).toBe('NEEDS_REVIEW');
  expect(parsed[0].dinas_target).toBeNull();
  expect(parsed[0].reason_if_invalid).toMatch(/NOTADINAS/);
});

// Self-repost: Requester and Recipient the same dinas never needs cross-dinas confirmation, same
// as the old parser's uploaderDinas-vs-prefix EXCLUDED check — checked against the row's OWN
// Requester column (case-insensitive) here, since Format CBO carries it explicitly per row.
// uploaderDinas is deliberately set to something ELSE ('TAB', e.g. an admin re-uploading on a
// dinas's behalf) so this only passes if the Requester-column comparison itself works, not just
// the pre-existing uploaderDinas-vs-Recipient check.
test('Requester === Recipient (same dinas on both, case-insensitive) gets EXCLUDED', async () => {
  const tmpPath = await buildFormatCboWorkbook([
    ['TC', '40021005', 'Expendable-Material', 'ZGMFTCW', '1900099001', '006', 'test', '', 100, 'USD', '', 'TC'],
    ['tc', '40021005', 'Expendable-Material', 'ZGMFTCW', '1900099001', '006', 'test', '', 50, 'USD', '', 'TC'],
  ]);
  const parsed = await parseExcelFile(tmpPath, { uploaderDinas: 'TAB' });
  require('fs').unlinkSync(tmpPath);

  expect(parsed.length).toBe(2);
  expect(parsed.every((r) => r.status_konfirmasi === 'EXCLUDED')).toBe(true);
});
