const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Format CBO (official input template, Format_Detail_Transaksi.xlsx, SRS.md "TERJAWAB 15 Agu")
// — the ONLY input format now (replaces the old ad-hoc 53-column TB/TJ/TM contract + pivot/
// pivot-cache/"Review <dinas>"-fallback machinery entirely). Requester and Recipient are handled
// separately below (they drive dinas_inisiasi/dinas_target, not stored as their own transaction
// field); the remaining 8 are plain value columns.
const CONTRACT_FIELDS = [
  { key: 'account', variants: ['Account'] },
  { key: 'profit_ctr', variants: ['Profit Ctr', 'Profit Center'] },
  { key: 'ref_doc', variants: ['Ref.Doc.', 'Ref Doc', 'Ref.Doc'] },
  { key: 'period', variants: ['Period'] },
  { key: 'text_desc', variants: ['Text', 'Text Description', 'Text Desc'] },
  { key: 'material', variants: ['Material'] },
  { key: 'in_pclc', variants: ['In PCLC', 'InPCLC'] },
  { key: 'curr', variants: ['Curr.', 'Curr'] },
];

function loadJSON(relPath) {
  const p = path.join(__dirname, '..', 'config', relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Codes a raw Recipient value can resolve to without an explicit mapping.seed.json entry —
// mapping's own keys+values plus the full canonical dinas roster (dinas.codes.json).
//
// Returns a Map from UPPERCASE key -> the ORIGINAL casing seen in mapping/dinasCodes (not a Set
// of uppercased codes) — dinas 'Corp' is stored mixed-case in rdt.dinas, so uppercasing it to
// 'CORP' before insert would violate the dinas_target FK. Callers must .get() the canonical form
// rather than re-deriving it from the uppercased input.
function buildAllowedCodes(mapping, dinasCodes) {
  const map = new Map();
  Object.keys(mapping).forEach((k) => map.set(String(mapping[k]).toUpperCase(), String(mapping[k])));
  Object.values(mapping).forEach((v) => map.set(String(v).toUpperCase(), String(v)));
  (dinasCodes || []).forEach((c) => map.set(String(c).toUpperCase(), String(c)));
  return map;
}

// Helper: read cell value preferring cached formula result when present
function readCellValue(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  // exceljs may represent rich text, dates, etc.
  if (v && typeof v === 'object' && v.text) return v.text;
  return v;
}

function parseNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  // Remove thousands sep and replace comma decimal if needed
  const s = String(val).trim();
  // handle formats like "5.926,66" (European)
  const euro = s.match(/^[-+]?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]+$/);
  if (euro) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  // handle plain with commas as thousands
  const plain = s.replace(/,/g, '');
  const n = Number(plain);
  return Number.isNaN(n) ? null : n;
}

// Single source of truth for turning one row's worth of already-extracted Format CBO field values
// into a transaction row. dinas_target now comes directly from the Recipient column (no more
// Remarks-prefix parsing / "Review <dinas>" fallback / sub-dinas suffix guessing — Format CBO
// ships it explicit), still resolved through mapping.seed.json aliases + the canonical dinas
// roster so an unrecognized value surfaces as NEEDS_REVIEW instead of silently misrouting.
function buildDetailRow({ sheetName, rowNumber, fieldValues, remark, detailGroup, recipientRaw, requesterRaw, mapping, exclusions, uploaderDinas, rawPayload, dinasCodes }) {
  const nominal = parseNumber(fieldValues.in_pclc);
  const recipient = recipientRaw ? String(recipientRaw).trim() : null;
  const requester = requesterRaw ? String(requesterRaw).trim() : null;

  // "Ask TA" is NOT a dinas — it's a signal the row's ownership is ambiguous and needs manual TAB
  // investigation (see routes/investigation.js), distinct from NEEDS_REVIEW's "unmapped code".
  const isAskTaInvestigation = recipient === 'Ask TA';

  const allowedCodes = buildAllowedCodes(mapping, dinasCodes);
  let dinasTarget = null;
  if (!isAskTaInvestigation && recipient) {
    const mapped = mapping[recipient] || mapping[recipient.toLowerCase()] || mapping[recipient.toUpperCase()];
    dinasTarget = mapped || allowedCodes.get(recipient.toUpperCase()) || null;
  }

  // Self-repost: a row whose own Requester equals its own Recipient never needs cross-dinas
  // confirmation. Checked against the row's OWN Requester column (not just uploaderDinas/session)
  // since Format CBO carries it explicitly per row — the session dinas SHOULD normally match, but
  // the file's own stated Requester is the more direct signal for this specific row.
  let status = 'PENDING';
  if (recipient && requester && recipient.toUpperCase() === requester.toUpperCase()) {
    status = 'EXCLUDED';
  } else if (recipient && uploaderDinas && recipient.toUpperCase() === String(uploaderDinas).toUpperCase()) {
    status = 'EXCLUDED';
  } else if (recipient && exclusions.prefixes.includes(recipient)) {
    status = 'EXCLUDED';
  }
  // Captured before the resolution branch below, so a row already correctly EXCLUDED never gets
  // silently overwritten to NEEDS_REVIEW/NEEDS_INVESTIGATION just because Recipient also fails to
  // resolve as a dinas code (e.g. an exclusions.config.json prefix like "AUAK" never does).
  const preResolvedExcluded = status === 'EXCLUDED';

  if (nominal === null || Number.isNaN(nominal)) {
    status = 'INVALID';
  }

  let reason_if_invalid = null;
  if (isAskTaInvestigation) {
    if (status === 'PENDING') status = 'NEEDS_INVESTIGATION';
  } else if (recipient && !dinasTarget && !preResolvedExcluded) {
    status = 'NEEDS_REVIEW';
    reason_if_invalid = `Unknown Recipient: ${recipient}`;
  } else if (!recipient && status !== 'INVALID' && !preResolvedExcluded) {
    status = 'NEEDS_REVIEW';
    reason_if_invalid = 'Missing Recipient — tidak bisa menentukan dinas target';
  }

  return {
    sheet: sheetName,
    row: rowNumber,
    dinas_inisiasi: uploaderDinas || null,
    account: fieldValues.account,
    profit_ctr: fieldValues.profit_ctr,
    ref_doc: fieldValues.ref_doc,
    period: fieldValues.period,
    text_desc: fieldValues.text_desc,
    material: fieldValues.material,
    in_pclc: fieldValues.in_pclc,
    curr: fieldValues.curr,
    nominal: nominal,
    remark: remark,
    category: detailGroup,
    dinas_target: dinasTarget,
    reason_if_invalid: reason_if_invalid,
    status_konfirmasi: status,
    raw_payload: rawPayload,
  };
}

async function parseExcelFile(filePath, options = {}) {
  // mapping/exclusions/dinasCodes come from the DB when a caller passes them in (index.js's
  // POST /api/parse, when DATABASE_URL is set) so TAB's Admin UI edits actually affect parsing;
  // otherwise fall back to the local JSON seed files (tests, no-DB callers).
  const mapping = options.mapping || loadJSON('mapping.seed.json');
  const exclusions = options.exclusions || loadJSON('exclusions.config.json');
  const dinasCodes = options.dinasCodes || (loadJSON('dinas.codes.json').codes) || [];
  const uploaderDinas = options.uploaderDinas || null;

  const workbook = new ExcelJS.Workbook();
  // use xlsx readFile which preserves formula result in cell.value.result
  await workbook.xlsx.readFile(filePath);

  const results = [];

  workbook.eachSheet((worksheet) => {
    // Format CBO is the only input shape now — read whichever sheet's header row has these
    // columns, whatever the sheet is named. Requester/Recipient/Remarks/Detail Group are found by
    // name (not fixed position) same as the 8 CONTRACT_FIELDS below.
    const headerRow = worksheet.getRow(1);
    const headerIndex = {};
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const name = String(readCellValue(cell) || '').trim();
      if (name) {
        headerIndex[name] = headerIndex[name] || [];
        headerIndex[name].push(colNumber);
      }
    });
    const headerNamesLower = new Set(Object.keys(headerIndex).map((h) => h.toLowerCase()));

    const needed = ['Account', 'Profit Ctr', 'In PCLC', 'Recipient'];
    if (!needed.every((k) => headerNamesLower.has(k.toLowerCase()))) return; // not a Format CBO sheet — skip (e.g. a lookup/reference sheet)

    const posName = {};
    Object.keys(headerIndex).forEach((name) => headerIndex[name].forEach((col) => { posName[col] = name; }));
    const maxCol = Math.max(0, ...Object.keys(posName).map(Number));

    const headerPos = {};
    let scanCol = 1;
    for (const ex of CONTRACT_FIELDS) {
      let found;
      for (let c = scanCol; c <= maxCol; c++) {
        const h = posName[c] || '';
        if (ex.variants.some((v) => v.toLowerCase() === h.toLowerCase())) { found = c; scanCol = c + 1; break; }
      }
      headerPos[ex.key] = found;
    }

    const findCol = (matchFn) => {
      for (const name of Object.keys(headerIndex)) {
        if (matchFn(name.toLowerCase())) return headerIndex[name][0];
      }
      return undefined;
    };
    const remarksCol = findCol((n) => n.startsWith('remark'));
    const detailGroupCol = findCol((n) => n === 'detail group');
    const recipientCol = findCol((n) => n === 'recipient');
    const requesterCol = findCol((n) => n === 'requester');

    const coveredCols = new Set([...Object.values(headerPos).filter(Boolean), remarksCol, detailGroupCol, recipientCol, requesterCol].filter(Boolean));
    const lastCol = Math.max(maxCol, worksheet.columnCount || 0);

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const fieldValues = {};
      CONTRACT_FIELDS.forEach((ex) => {
        fieldValues[ex.key] = headerPos[ex.key] ? readCellValue(row.getCell(headerPos[ex.key])) : null;
      });

      const remark = remarksCol ? readCellValue(row.getCell(remarksCol)) : null;
      const detailGroup = detailGroupCol ? readCellValue(row.getCell(detailGroupCol)) : null;
      const recipientRaw = recipientCol ? readCellValue(row.getCell(recipientCol)) : null;
      const requesterRaw = requesterCol ? readCellValue(row.getCell(requesterCol)) : null;

      const rawPayload = {};
      for (let c = 1; c <= lastCol; c++) {
        if (coveredCols.has(c)) continue;
        rawPayload[posName[c] || `col_${c}`] = readCellValue(row.getCell(c));
      }

      results.push(buildDetailRow({
        sheetName: worksheet.name,
        rowNumber,
        fieldValues,
        remark,
        detailGroup,
        recipientRaw,
        requesterRaw,
        mapping,
        exclusions,
        uploaderDinas,
        rawPayload,
        dinasCodes,
      }));
    });
  });

  return results;
}

module.exports = {
  parseExcelFile,
  // routes/exportBatches.js's full-column per-pair export reuses this for real contract header
  // labels (Account, Profit Ctr, ...) instead of guessing/retyping them.
  CONTRACT_FIELDS,
};
