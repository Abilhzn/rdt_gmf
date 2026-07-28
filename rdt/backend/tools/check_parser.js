const path = require('path');
const { parseExcelFile } = require('../src/parser/excelParser');

function aggregate(results) {
  const out = {};
  results.forEach((r) => {
    if (r.status_konfirmasi !== 'PENDING') return;
    const cat = r.category || 'Unknown';
    const dt = r.dinas_target || 'Unknown';
    out[cat] = out[cat] || {};
    out[cat][dt] = (out[cat][dt] || 0) + Number(r.nominal || 0);
  });
  Object.keys(out).forEach((cat) => {
    Object.keys(out[cat]).forEach((dt) => {
      out[cat][dt] = Math.round(out[cat][dt] * 100) / 100;
    });
  });
  return out;
}

(async () => {
  const file = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TB - Jun 2026.xlsx');
  const rows = await parseExcelFile(file, { uploaderDinas: 'TB' });
  const aggRaw = aggregate(rows);
  // normalize category names to canonical SRS categories
  const agg = {};
  Object.keys(aggRaw).forEach(cat => {
    const key = String(cat || '').toLowerCase();
    let canonical = cat;
    if (key.includes('expend')) canonical = 'Expendable';
    else if (key.includes('repair')) canonical = 'Repairable';
    else if (key.includes('scrap') || key.includes('spare')) canonical = 'Scrap';
    agg[canonical] = Object.assign({}, agg[canonical] || {}, aggRaw[cat]);
  });
  console.log('AGG:', JSON.stringify(agg, null, 2));
  // expected from SRS
  const expected = {
    Expendable: { TC: 85312.21, TF: 360.21, TJ: 46353.37, TL: 112867.35, TN: 860.64 },
    Repairable: { Corp: 3038.48, TC: 9420 },
    Scrap: { Corp: 256.47 },
  };
  let ok = true;
  Object.keys(expected).forEach(cat => {
    if (!agg[cat]) { console.error('Missing category', cat); ok = false; return; }
    Object.keys(expected[cat]).forEach(dt => {
      const got = agg[cat][dt] || 0;
      const want = expected[cat][dt];
      const diff = Math.abs(got - want);
      if (diff > 0.02) { console.error(`Mismatch ${cat}:${dt} got=${got} want=${want}`); ok=false; }
    });
  });
  if (ok) console.log('CHECK OK'); else { console.error('CHECK FAILED'); process.exit(2); }
})().catch(e=>{ console.error(e); process.exit(1); });
