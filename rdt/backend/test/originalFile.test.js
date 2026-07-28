const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeFilename, saveOriginalFile } = require('../src/persist/originalFile');
const { parseExcelFile } = require('../src/parser/excelParser');

jest.setTimeout(300000);

describe('sanitizeFilename', () => {
  test('keeps a normal filename as-is', () => {
    expect(sanitizeFilename('06. DT TB - Jun 2026.xlsx')).toBe('06._DT_TB_-_Jun_2026.xlsx');
  });

  test('strips directory components — no path traversal via a crafted original_filename', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\windows\\system32\\evil.xlsx')).toBe('evil.xlsx');
  });

  test('falls back to a default name when given nothing usable', () => {
    expect(sanitizeFilename(null)).toBe('upload.xlsx');
    expect(sanitizeFilename('')).toBe('upload.xlsx');
  });
});

describe('saveOriginalFile — round trip against a real workbook (REQ-RDT-EXT-08 / REQ-RDT-LEDGER-09)', () => {
  const sourceFile = path.join(__dirname, '..', '..', 'contoh_input', '06. DT TB - Jun 2026.xlsx');
  let uploadDir;
  let tempFile;

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-uploads-test-'));
    // Mirror what multer does: the "uploaded" bytes first land at a temp path inside uploadDir.
    tempFile = path.join(uploadDir, `${Date.now()}-06. DT TB - Jun 2026.xlsx`);
    fs.copyFileSync(sourceFile, tempFile);
  });

  afterEach(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  test('saved file is byte-identical to the original (not a re-export)', () => {
    const originalBytes = fs.readFileSync(sourceFile);
    const savedName = saveOriginalFile(uploadDir, 42, tempFile, '06. DT TB - Jun 2026.xlsx');
    const savedBytes = fs.readFileSync(path.join(uploadDir, savedName));
    expect(savedBytes.equals(originalBytes)).toBe(true);
  });

  test('saved filename is prefixed with the upload id and sanitized', () => {
    const savedName = saveOriginalFile(uploadDir, 42, tempFile, '06. DT TB - Jun 2026.xlsx');
    expect(savedName).toBe('42-06._DT_TB_-_Jun_2026.xlsx');
  });

  // This is the scenario the project owner asked to be verified explicitly: after "downloading"
  // (i.e. re-serving the saved copy), the file must still open normally and its formulas must
  // still resolve correctly — not #REF! — rather than just existing as inert bytes. Re-running
  // the same parser regression assertions (SRS test scenario #8) against the SAVED copy proves
  // both: it opens, and every formula-derived aggregate still matches the known-correct pivot.
  test('the saved copy opens normally and its formula-derived aggregates still match the SRS pivot', async () => {
    const savedName = saveOriginalFile(uploadDir, 42, tempFile, '06. DT TB - Jun 2026.xlsx');
    const downloadedPath = path.join(uploadDir, savedName);

    const results = await parseExcelFile(downloadedPath);
    const agg = {};
    results.forEach((r) => {
      if (r.status_konfirmasi !== 'PENDING') return;
      const cat = String(r.category || 'Unknown').toLowerCase();
      const canonical = cat.includes('expend') ? 'Expendable' : cat.includes('repair') ? 'Repairable' : (cat.includes('scrap') || cat.includes('spare')) ? 'Scrap' : r.category;
      const dt = r.dinas_target || 'Unknown';
      agg[canonical] = agg[canonical] || {};
      agg[canonical][dt] = Math.round(((agg[canonical][dt] || 0) + Number(r.nominal || 0)) * 100) / 100;
    });

    const expected = {
      Expendable: { TC: 85312.21, TF: 360.21, TJ: 46353.37, TL: 112867.35, TN: 860.64 },
      Repairable: { Corp: 3038.48, TC: 9420 },
      Scrap: { Corp: 256.47 },
    };
    Object.keys(expected).forEach((cat) => {
      Object.keys(expected[cat]).forEach((dt) => {
        expect(agg[cat][dt]).toBeCloseTo(expected[cat][dt], 2);
      });
    });
  });
});
