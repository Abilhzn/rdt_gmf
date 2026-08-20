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

// Retired 20 Agu: these 2 tests covered contoh_input/06. DT TJ JUN 2026 R1.xlsx (TJ-TE/TJ-TMM/
// TJ-Scrap reconciliation sheets skipped, Remarks/Review-column routing onto the main sheet). That
// fixture is intentionally not being replaced — TJ's real-world file has since moved to the
// official "Format CBO" template (explicit Recipient column, see SRS.md "TERJAWAB 15 Agu"), which
// the parser doesn't read yet (input-side change, still an open question). Once that's resolved,
// replace these with equivalent coverage against the new format instead of this retired one.
