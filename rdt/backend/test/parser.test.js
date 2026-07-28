const path = require('path');
const { parseExcelFile } = require('../src/parser/excelParser');

// Increase timeout for Excel parsing on CI
jest.setTimeout(300000);

function aggregate(results) {
  // Group by category (GL) and dinas_target, sum nominal
  const out = {};
  results.forEach((r) => {
    if (r.status_konfirmasi !== 'PENDING') return;
    const cat = r.category || 'Unknown';
    const dt = r.dinas_target || 'Unknown';
    out[cat] = out[cat] || {};
    out[cat][dt] = (out[cat][dt] || 0) + Number(r.nominal || 0);
  });
  // round to 2 decimals
  Object.keys(out).forEach((cat) => {
    Object.keys(out[cat]).forEach((dt) => {
      out[cat][dt] = Math.round(out[cat][dt] * 100) / 100;
    });
  });
  return out;
}

test('parser aggregates match SRS pivot numbers', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TB - Jun 2026.xlsx');
  const results = await parseExcelFile(file);
  const agg = aggregate(results);
  // Normalize category names to canonical SRS categories for assertion
  const normalized = {};
  Object.keys(agg).forEach((cat) => {
    const key = String(cat || '').toLowerCase();
    let canonical = cat;
    if (key.includes('expend')) canonical = 'Expendable';
    else if (key.includes('repair')) canonical = 'Repairable';
    else if (key.includes('scrap') || key.includes('spare')) canonical = 'Scrap';
    normalized[canonical] = Object.assign({}, normalized[canonical] || {}, agg[cat]);
  });

  // console.log('NORMALIZED AGG:', JSON.stringify(normalized, null, 2));

  // Expected values from SRS. We'll assert presence and equality where available.
  // Expendable category expected (likely in GL column values)
  // The sample file's category naming might vary; we'll try to find matching numbers across categories

  const expected = {
    Expendable: { TC: 85312.21, TF: 360.21, TJ: 46353.37, TL: 112867.35, TN: 860.64 },
    Repairable: { Corp: 3038.48, TC: 9420 },
    Scrap: { Corp: 256.47 },
  };

  // verify expected numbers found in agg
  Object.keys(expected).forEach((cat) => {
    expect(normalized[cat]).toBeDefined();
    Object.keys(expected[cat]).forEach((dt) => {
      const got = normalized[cat][dt] || 0;
      const want = expected[cat][dt];
      expect(got).toBeCloseTo(want, 2);
    });
  });
});

// REQ-RDT-EXT-01 CORRECTION (25 Jul 2026, superseding the 23 Jul "second transaction format"
// theory): contoh_input/06. DT TJ JUN 2026 R1.xlsx's TJ-TE/TJ-TMM/TJ-Scrap sheets (Cost.Ctr1/
// Cost.Element/Amount/Curr./Cost.Ctr2/Qty/UoM/Text) are NOT additional transactions — they are a
// per-destination reconciliation breakdown of rows already on the main sheet, routed via its own
// "Review TJ" column. Verified by opening the real file directly: every TJ-TMM row's amount
// matches one among the main sheet's Review-TJ="TMM" rows (321/321), and TJ-TE/TJ-Scrap's sheet
// totals exactly equal the main sheet's own Review-TJ="TE"/"TA" sums, with nothing left over —
// extracting them as a second source (the prior behavior) double-counted every one of them,
// which is exactly the bug the project owner reported live (TM shown as 797,421.97 = the correct
// 473,933.51 plus TJ-TMM's own 323,488.46 duplicate). They're now skipped like any other lookup/
// reference sheet (e.g. TB's SQ00/ziw29/po/WBS/IW38/GL). Also covers the accompanying fix where a
// row with an empty/unparseable Remarks value used to default to PENDING with dinas_target=null
// (unroutable, invisible to every dinas's confirmation queue forever) instead of being flagged
// NEEDS_REVIEW like any other unresolvable destination.
// UPDATE (28 Jul, project owner correction supersedes the 25 Jul SRS 3.1.2 "don't guess" call):
// TA and "Ask TA" ARE dinas TA (real, distinct dinas_target — NOT 'TAB'; TAB is the admin
// division and has deliberately no rdt.dinas row, so resolving to it violates
// transactions_dinas_target_fkey on a real repost, confirmed live 28 Jul). "TA people being
// staffed by TAB" is an AUTHORIZATION fact (role TAB can act on any dinas, and is the only role
// staffing TA/Corp's queues since neither has a dedicated PIC — REQ-RDT-AUTH-04), not a reason to
// rewrite the target value itself — see schema.sql's rdt.dinas seed comment. TMM is a SUB-DINAS
// of TM, written as TM's own code plus a trailing letter with no separator — the project owner
// confirmed this "code + suffix" convention is used GMF-wide for sub-dinas, not TJ-specific, so
// it's implemented generically (resolveSubDinasCode, against the canonical roster in
// dinas.codes.json) rather than as a one-off TMM->TM alias. No row should be silently unroutable
// (PENDING with no dinas_target) either way.
test('parser skips the TJ-TE/TJ-TMM/TJ-Scrap reconciliation sheets and routes everything via the main sheet', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TJ JUN 2026 R1.xlsx');
  const results = await parseExcelFile(file, { uploaderDinas: 'TJ' });

  // The breakdown sheets contribute nothing — every one of their rows is a duplicate of a main
  // sheet row that's already counted below.
  expect(results.some((r) => ['TJ-TE', 'TJ-TMM', 'TJ-Scrap'].includes(r.sheet))).toBe(false);

  const mainSheetRows = results.filter((r) => r.sheet === 'DT TJ JUN 2026 R1');
  expect(mainSheetRows.length).toBeGreaterThan(0);
  expect(mainSheetRows.some((r) => r.status_konfirmasi === 'PENDING' && !r.dinas_target)).toBe(false);
  const mainByTarget = {};
  mainSheetRows.filter((r) => r.status_konfirmasi === 'PENDING').forEach((r) => {
    mainByTarget[r.dinas_target] = Math.round(((mainByTarget[r.dinas_target] || 0) + Number(r.nominal || 0)) * 100) / 100;
  });
  // TE resolves directly; TA + "Ask TA" both resolve to TA (1653.24 + 40393.29 = 42046.53); TMM
  // resolves to TM via the sub-dinas suffix rule. Every row now resolves — no NEEDS_REVIEW left.
  expect(mainByTarget).toEqual({ TE: 84.36, TA: 42046.53, TM: 473933.51 });
  const mainNeedsReview = mainSheetRows.filter((r) => r.status_konfirmasi === 'NEEDS_REVIEW');
  expect(mainNeedsReview.length).toBe(0);
});

// Task #15 (27 Jul) + 28 Jul dinas-routing correction (project owner confirmed): R1's main sheet
// must parse to 490/490 DETAIL_ROW rows whose PENDING totals match contoh_input/06. DT TJ -
// Jun 2026.xlsx's pivot-cache aggregates EXACTLY: TM=473933.51 (475 rows, ex-"TMM" sub-dinas
// suffix), TA=42046.53 (14 rows: 11 ex-"TA" + 3 ex-"Ask TA"), TE=84.36 (1 row). Grouped by
// dinas_target now that all four buckets resolve (see the un-guessing test above for why).
test('R1 main sheet: full 490-row detail total matches the pivot-cache aggregates exactly', async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TJ JUN 2026 R1.xlsx');
  const results = await parseExcelFile(file, { uploaderDinas: 'TJ' });
  const mainSheetRows = results.filter((r) => r.sheet === 'DT TJ JUN 2026 R1');
  expect(mainSheetRows.length).toBe(490);

  const round2 = (n) => Math.round(n * 100) / 100;

  // TE: the one destination already in mapping.seed.json — resolves normally, PENDING.
  const teRows = mainSheetRows.filter((r) => r.status_konfirmasi === 'PENDING' && r.dinas_target === 'TE');
  expect(teRows.length).toBe(1);
  expect(round2(teRows.reduce((s, r) => s + Number(r.nominal || 0), 0))).toBeCloseTo(84.36, 2);

  // TM: routed via "Review TJ" = "TMM" (Remarks empty on all 475 of these rows) through the
  // sub-dinas suffix rule ("TMM" = dinas TM + suffix "M").
  const tmRows = mainSheetRows.filter((r) => r.status_konfirmasi === 'PENDING' && r.dinas_target === 'TM');
  expect(tmRows.length).toBe(475);
  expect(round2(tmRows.reduce((s, r) => s + Number(r.nominal || 0), 0))).toBeCloseTo(473933.51, 2);

  // TA: 11 rows whose Remarks holds a free-text note ("Scrap. Mohon ditakeout", not a dinas
  // prefix) fall back to Review TJ="TA" (a real, distinct dinas_target — not TAB), plus 3 rows
  // whose Remarks is other free text fall back to Review TJ="Ask TA"->TA — together exactly
  // reproduce the pivot's combined TA+"Ask TA" bucket.
  const taRows = mainSheetRows.filter((r) => r.status_konfirmasi === 'PENDING' && r.dinas_target === 'TA');
  expect(taRows.length).toBe(14);
  expect(round2(taRows.reduce((s, r) => s + Number(r.nominal || 0), 0))).toBeCloseTo(42046.53, 2);

  // Nothing left unaccounted for: TE + TM + TA rows must be every row in the sheet.
  expect(teRows.length + tmRows.length + taRows.length).toBe(490);
});
