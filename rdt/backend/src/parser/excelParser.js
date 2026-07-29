const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { readPivotCaches } = require('./pivotCacheReader');

// Expected 53 contract headers in order (variants allowed) — REQ-RDT-EXT-01. Module-level because
// both the live-worksheet path and the pivot-cache path (REQ-RDT-EXT-09 jalur 1b) need the same
// canonical key/variant list to resolve a source's columns/fields to the same output shape.
const CONTRACT_FIELDS = [
  { key: 'account', variants: ['Account'] },
  { key: 'cost_ctr', variants: ['Cost Ctr','Cost Centre','CostCenter'] },
  { key: 'profit_ctr', variants: ['Profit Ctr','Profit Center'] },
  { key: 'partner_pc', variants: ['Partner PC','Partner'] },
  { key: 'document_no', variants: ['DocumentNo','Document No','Document'] },
  { key: 'ref_doc', variants: ['Ref.Doc.','Ref Doc','Ref.Doc'] },
  { key: 'period', variants: ['Period'] },
  { key: 'text_desc', variants: ['Text','Text Description','Text Desc'] },
  { key: 'acc_text', variants: ['Acc.Text','Acc Text'] },
  { key: 'sap_user', variants: ['User','SAP User'] },
  { key: 'sales_doc', variants: ['Sales Doc.','Sales Doc'] },
  { key: 'wbs_elem', variants: ['WBS Elem.','WBS'] },
  { key: 'purch_doc', variants: ['Purch.Doc.','Purch Doc'] },
  { key: 'order_no', variants: ['Order','Order No'] },
  { key: 'fiscal_year', variants: ['Year'] },
  { key: 'elim_prctr', variants: ['Elim.PrCtr','Elim PrCtr'] },
  { key: 'obj_class', variants: ['Obj. class','ObjCl','Obj Class'] },
  { key: 'customer', variants: ['Customer'] },
  { key: 'vendor', variants: ['Vendor'] },
  { key: 'plant', variants: ['Plant'] },
  { key: 'material', variants: ['Material'] },
  { key: 'time_val', variants: ['Time'] },
  { key: 'year_2', variants: ['Year'] },
  { key: 'ref_org_un', variants: ['Ref.Org Un','Ref Org Un'] },
  { key: 'val_a', variants: ['ValA','Val A'] },
  { key: 'mvt', variants: ['MvT','Mvt'] },
  { key: 'type', variants: ['Type'] },
  { key: 'sales_ord', variants: ['Sales Ord.','Sales Ord'] },
  { key: 's_no', variants: ['SNo.','SNo'] },
  { key: 'bus_a', variants: ['BusA','Bus A'] },
  { key: 'func_area', variants: ['Func. Area','Func Area'] },
  { key: 'acty', variants: ['Acty'] },
  { key: 'asset', variants: ['Asset'] },
  { key: 'rep_mat', variants: ['Rep. mat.','Rep mat'] },
  { key: 'ar', variants: ['Ar.','AR'] },
  { key: 'dt', variants: ['DT'] },
  { key: 'ref_tran', variants: ['Ref. Tran.','Ref Tran'] },
  { key: 'item', variants: ['Item'] },
  { key: 'bill_t', variants: ['BillT','Bill T'] },
  { key: 'sd_doc', variants: ['SD Doc.','SD Doc'] },
  { key: 's_grp', variants: ['SGrp','S Grp'] },
  { key: 's_off', variants: ['SOff.','SOff'] },
  { key: 'co_ar', variants: ['COAr','Co Ar'] },
  { key: 'in_pclc', variants: ['In PCLC','InPCLC'] },
  { key: 'curr', variants: ['Curr.','Curr'] },
  { key: 'doc_date', variants: ['Doc. Date','Doc Date'] },
  { key: 'pstng_date', variants: ['Pstng Date','Posting Date'] },
  { key: 'in_ccc', variants: ['In CCC','InCCC'] },
  { key: 'in_tc', variants: ['In TC','InTC'] },
  { key: 'qty', variants: ['Qty','Quantity'] },
  { key: 'unit', variants: ['Unit'] },
  { key: 'entry_dte', variants: ['Entry Dte','Entry Date'] },
  { key: 'value_date', variants: ['Value Date','ValueDate'] },
];

function loadJSON(relPath) {
  const p = path.join(__dirname, '..', 'config', relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Codes a raw Remarks/Review value can resolve to without an explicit mapping.seed.json entry —
// mapping's own keys+values (aliases already confirmed) plus the full canonical dinas roster
// (dinas.codes.json), so e.g. a bare "TM" resolves even though no dinas needs an alias entry for
// its own code.
function buildAllowedCodes(mapping, dinasCodes) {
  const set = new Set(
    Object.keys(mapping).map((k) => String(mapping[k]).toUpperCase())
      .concat(Object.values(mapping).map((v) => String(v).toUpperCase()))
  );
  (dinasCodes || []).forEach((c) => set.add(String(c).toUpperCase()));
  return set;
}

// GMF-wide sub-dinas naming convention (confirmed by project owner, 28 Jul 2026): a value that
// isn't a known code/alias on its own may still be a SUB-DINAS of a real one, written as that
// code plus extra trailing letters with no separator — e.g. "TMM" is dinas TM's own sub-unit.
// Only matches when the candidate is strictly longer than the base code (so a code never
// "matches itself" here — that's allowedCodes' job) and picks the LONGEST matching base to avoid
// a shorter code shadowing a more specific one.
function resolveSubDinasCode(rawUpper, dinasCodes) {
  if (!rawUpper || !/^[A-Z]+$/.test(rawUpper)) return null;
  let best = null;
  (dinasCodes || []).forEach((c) => {
    const cu = String(c).toUpperCase();
    if (rawUpper.length > cu.length && rawUpper.startsWith(cu)) {
      if (!best || cu.length > best.length) best = cu;
    }
  });
  return best;
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

// REQ-RDT-EXT-09 (25 Jul, fallback strategy): generates one synthetic transaction row per pivot
// Column Label (dinas target) when no ala-TB detail sheet was found anywhere in the workbook.
// Layout verified against contoh_input/06. DT TJ - Jun 2026.xlsx: a "Row Labels" header cell
// (col 1) marks the header row, the remaining columns up to (and excluding) a trailing "Grand
// Total" column are dinas Column Labels, and data rows run until a row whose col-1 label is
// literally "Grand Total" (excluded). nominal per dinas = SUM across all row-label cells in that
// column (not one row per pivot cell) — this is what the SUM has to equal to reproduce the
// per-dinas Grand Total row exactly, which is what downstream confirmation actually cares about
// at this granularity (no document-level detail survives a pivot-only export anyway). Dinas-target
// resolution uses mapping.seed.json + the canonical dinas.codes.json roster + the GMF-wide
// sub-dinas suffix convention (resolveSubDinasCode) — still no blind first-two-letters guessing,
// so a column label matching none of those (truly unknown) surfaces as NEEDS_REVIEW rather than
// being guessed, per SRS 3.1.2's explicit "jangan menebak sendiri".
function derivePivotRowsFromSheet(worksheet, mapping, exclusions, uploaderDinas, dinasCodes) {
  let headerRowNum = null;
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (headerRowNum) return;
    const a = String(readCellValue(row.getCell(1)) || '').trim().toLowerCase();
    if (a === 'row labels') headerRowNum = rowNumber;
  });
  if (!headerRowNum) return [];

  const headerRow = worksheet.getRow(headerRowNum);
  const columnLabels = {}; // colNumber -> raw Column Label text
  let maxCol = 1;
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber === 1) return; // the "Row Labels" column itself, not a dinas column
    const label = String(readCellValue(cell) || '').trim();
    if (label) { columnLabels[colNumber] = label; maxCol = Math.max(maxCol, colNumber); }
  });
  // Trailing column is always the per-row "Grand Total" — never a real dinas target.
  delete columnLabels[maxCol];

  const sums = {};
  const sawValue = {};
  for (let r = headerRowNum + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rowLabel = String(readCellValue(row.getCell(1)) || '').trim();
    if (!rowLabel || rowLabel.toLowerCase() === 'grand total') break;
    Object.keys(columnLabels).forEach((colStr) => {
      const col = Number(colStr);
      const val = parseNumber(readCellValue(row.getCell(col)));
      if (val !== null) {
        sums[col] = (sums[col] || 0) + val;
        sawValue[col] = true;
      }
    });
  }

  const allowedCodes = buildAllowedCodes(mapping, dinasCodes);

  const rows = [];
  Object.keys(columnLabels).forEach((colStr) => {
    const col = Number(colStr);
    if (!sawValue[col]) return; // column had no non-empty cell at all — nothing to synthesize
    const rawPrefix = columnLabels[col];
    const nominal = sums[col];

    let status = 'PENDING';
    if (uploaderDinas && rawPrefix.toUpperCase() === String(uploaderDinas).toUpperCase()) {
      status = 'EXCLUDED';
    } else if (exclusions.prefixes.includes(rawPrefix)) {
      status = 'EXCLUDED';
    }

    // REQ-RDT-LEDGER-10: same "Ask TA" exact-string carve-out as buildDetailRow — this is the
    // same literal pivot column that appears in the real file (see SRS 3.1.2), just reached via
    // the jalur-2 pivot-only fallback instead of a live detail sheet's Remarks/Review columns.
    const isAskTaInvestigation = rawPrefix.trim() === 'Ask TA';
    const mapped = isAskTaInvestigation ? null : (mapping[rawPrefix] || mapping[rawPrefix.toLowerCase()] || mapping[rawPrefix.toUpperCase()]);
    let dinasTarget = null;
    let reason_if_invalid = null;
    if (isAskTaInvestigation) {
      if (status === 'PENDING') status = 'NEEDS_INVESTIGATION';
    } else if (mapped) {
      dinasTarget = mapped;
    } else {
      const rp = rawPrefix.toUpperCase();
      const subDinasBase = resolveSubDinasCode(rp, dinasCodes);
      if (allowedCodes.has(rp)) {
        dinasTarget = rp;
      } else if (subDinasBase) {
        dinasTarget = subDinasBase;
      } else {
        status = 'NEEDS_REVIEW';
        reason_if_invalid = `Unknown pivot column label: ${rawPrefix}`;
      }
    }

    rows.push({
      sheet: worksheet.name,
      row: null,
      dinas_inisiasi: uploaderDinas || null,
      nominal: nominal,
      remark: null,
      dinas_target: dinasTarget,
      reason_if_invalid: reason_if_invalid,
      status_konfirmasi: status,
      category: null,
      raw_payload: { pivot_column_label: rawPrefix },
      granularity: 'PIVOT_DERIVED',
    });
  });
  return rows;
}

// Single source of truth for turning one row's worth of already-extracted contract-field values
// into a transaction row — dinas_target resolution (Remarks prefix, "Review <dinas>" fallback),
// exclusion rules, nominal validation, NEEDS_REVIEW reasons. Used identically by both the live
// ala-TB worksheet path AND the pivot-cache DETAIL_ROW path (REQ-RDT-EXT-09 jalur 1b) — same rules
// either way, on purpose, so a row extracted from a cache is indistinguishable downstream from one
// read off a normal worksheet.
function buildDetailRow({ sheetName, rowNumber, fieldValues, remark, reviewRaw, gl, mapping, exclusions, uploaderDinas, granularity, rawPayload, dinasCodes }) {
  const nominal = parseNumber(fieldValues.in_pclc);
  let rawPrefix = remark ? String(remark).split('-')[0].trim() : null;
  // Only reached when Remarks is genuinely empty — never overrides a Remarks value, so this
  // can't change TB's (or any Remarks-routed dinas's) already-verified behavior.
  const prefixFromReview = !rawPrefix && !!reviewRaw;
  if (prefixFromReview) rawPrefix = String(reviewRaw).trim();
  // REQ-RDT-LEDGER-10 (27 Jul): the exact string "Ask TA" is NOT a dinas — it's a signal the
  // row's ownership is ambiguous and needs manual TAB investigation (see
  // routes/investigation.js), a different concept from NEEDS_REVIEW's "unmapped code, decide the
  // mapping once and it's fixed forever". Checked on the raw prefix exactly as-is (whichever
  // source it came from — Remarks or the Review-column fallback, buildDetailRow doesn't care),
  // BEFORE mapping/allowedCodes/sub-dinas resolution runs, so it never gets routed like a normal
  // dinas. Do NOT generalize this to other "Ask <code>" values without project owner
  // confirmation — see rdt/docs/SRS.md REQ-RDT-LEDGER-10.
  const isAskTaInvestigation = !!rawPrefix && rawPrefix.trim() === 'Ask TA';

  let dinasTarget = null;
  let mapped = null;
  if (!isAskTaInvestigation && rawPrefix) {
    mapped = mapping[rawPrefix] || mapping[rawPrefix.toLowerCase()] || mapping[rawPrefix.toUpperCase()];
    if (mapped) dinasTarget = mapped;
  }

  const allowedCodes = buildAllowedCodes(mapping, dinasCodes);

  let status = 'PENDING';
  if (rawPrefix && uploaderDinas && rawPrefix.toUpperCase() === String(uploaderDinas).toUpperCase()) {
    status = 'EXCLUDED';
  } else if (rawPrefix && exclusions.prefixes.includes(rawPrefix)) {
    status = 'EXCLUDED';
  }

  if (nominal === null || Number.isNaN(nominal)) {
    status = 'INVALID';
  }

  let reason_if_invalid = null;
  if (isAskTaInvestigation) {
    // Only overrides the default PENDING — EXCLUDED (self-repost/exclusion-list) and INVALID
    // (bad nominal) above still win, same precedence as every other status branch here.
    if (status === 'PENDING') status = 'NEEDS_INVESTIGATION';
  } else if (rawPrefix && !mapped) {
    const rp = rawPrefix.toUpperCase();
    const subDinasBase = resolveSubDinasCode(rp, dinasCodes);
    if (allowedCodes.has(rp)) {
      dinasTarget = rp;
    } else if (subDinasBase) {
      // GMF-wide sub-dinas suffix convention (e.g. Remarks/Review holding "TMM" for dinas TM's
      // own sub-unit) — see resolveSubDinasCode's header comment. Still never overrides a Remarks
      // value that already resolved via mapping/allowedCodes above.
      dinasTarget = subDinasBase;
    } else {
      // Remarks-derived value didn't resolve — before giving up, retry via the "Review <dinas>"
      // column if present. Still never overrides a Remarks value that DID resolve.
      const reviewFallbackRaw = !prefixFromReview && reviewRaw ? String(reviewRaw).trim() : null;
      // REQ-RDT-LEDGER-10: the exact same "Ask TA" carve-out applies here — a row whose Remarks
      // is unrelated free text (so it fails the mapping/allowedCodes/sub-dinas checks above) but
      // whose Review-column fallback is literally "Ask TA" is still an investigation signal, not
      // an unmapped-code NEEDS_REVIEW case.
      if (reviewFallbackRaw === 'Ask TA') {
        status = 'NEEDS_INVESTIGATION';
      } else {
        let resolvedFromReview = null;
        if (reviewFallbackRaw) {
          const reviewMapped = mapping[reviewFallbackRaw] || mapping[reviewFallbackRaw.toLowerCase()] || mapping[reviewFallbackRaw.toUpperCase()];
          const reviewUpper = reviewFallbackRaw.toUpperCase();
          resolvedFromReview = reviewMapped
            || (allowedCodes.has(reviewUpper) ? reviewUpper : null)
            || resolveSubDinasCode(reviewUpper, dinasCodes);
        }
        if (resolvedFromReview) {
          dinasTarget = resolvedFromReview;
        } else {
          status = 'NEEDS_REVIEW';
          reason_if_invalid = prefixFromReview
            ? `Unknown Review value: ${rawPrefix}`
            : `Unknown prefix: ${rawPrefix}`;
        }
      }
    }
  } else if (!rawPrefix && status !== 'INVALID') {
    status = 'NEEDS_REVIEW';
    reason_if_invalid = 'Missing Remarks — tidak bisa menentukan dinas target';
  }

  return {
    sheet: sheetName,
    row: rowNumber,
    dinas_inisiasi: uploaderDinas || null,
    account: fieldValues.account,
    cost_ctr: fieldValues.cost_ctr,
    profit_ctr: fieldValues.profit_ctr,
    partner_pc: fieldValues.partner_pc,
    document_no: fieldValues.document_no,
    ref_doc: fieldValues.ref_doc,
    period: fieldValues.period,
    text_desc: fieldValues.text_desc,
    acc_text: fieldValues.acc_text,
    sap_user: fieldValues.sap_user,
    sales_doc: fieldValues.sales_doc,
    wbs_elem: fieldValues.wbs_elem,
    purch_doc: fieldValues.purch_doc,
    order_no: fieldValues.order_no,
    fiscal_year: fieldValues.fiscal_year,
    elim_prctr: fieldValues.elim_prctr,
    obj_class: fieldValues.obj_class,
    customer: fieldValues.customer,
    vendor: fieldValues.vendor,
    plant: fieldValues.plant,
    material: fieldValues.material,
    time_val: fieldValues.time_val,
    year_2: fieldValues.year_2,
    ref_org_un: fieldValues.ref_org_un,
    val_a: fieldValues.val_a,
    mvt: fieldValues.mvt,
    type: fieldValues.type,
    sales_ord: fieldValues.sales_ord,
    s_no: fieldValues.s_no,
    bus_a: fieldValues.bus_a,
    func_area: fieldValues.func_area,
    acty: fieldValues.acty,
    asset: fieldValues.asset,
    rep_mat: fieldValues.rep_mat,
    ar: fieldValues.ar,
    dt: fieldValues.dt,
    ref_tran: fieldValues.ref_tran,
    item: fieldValues.item,
    bill_t: fieldValues.bill_t,
    sd_doc: fieldValues.sd_doc,
    s_grp: fieldValues.s_grp,
    s_off: fieldValues.s_off,
    co_ar: fieldValues.co_ar,
    in_pclc: fieldValues.in_pclc,
    curr: fieldValues.curr,
    doc_date: fieldValues.doc_date,
    pstng_date: fieldValues.pstng_date,
    in_ccc: fieldValues.in_ccc,
    in_tc: fieldValues.in_tc,
    qty: fieldValues.qty,
    unit: fieldValues.unit,
    entry_dte: fieldValues.entry_dte,
    value_date: fieldValues.value_date,
    nominal: nominal,
    remark: remark,
    dinas_target: dinasTarget,
    reason_if_invalid: reason_if_invalid,
    status_konfirmasi: status,
    category: gl,
    raw_payload: rawPayload,
    granularity: granularity,
  };
}

// Resolves each CONTRACT_FIELDS key to the header/field name (a string, not a column number) that
// matches one of its variants, scanning left-to-right through orderedNames — same left-to-right
// resolution rule the live-worksheet path uses for column positions, just over field NAMES instead
// (pivot cache fields have no fixed column position of their own).
function resolveContractKeys(orderedNames, contractFields) {
  const resolved = {};
  let scanIdx = 0;
  for (const ex of contractFields) {
    let found;
    for (let i = scanIdx; i < orderedNames.length; i++) {
      const h = orderedNames[i];
      if (ex.variants.some((v) => v.toLowerCase() === h.toLowerCase())) { found = h; scanIdx = i + 1; break; }
    }
    resolved[ex.key] = found;
  }
  return resolved;
}

// REQ-RDT-EXT-09 jalur 1b (26 Jul, project owner confirmed): before falling back to the coarse
// pivot-aggregate synthesis (derivePivotRowsFromSheet), check whether the workbook's PivotTable
// still carries its full source-row cache — Excel keeps this internally (it's what "double-click a
// pivot cell to drill down" reads from) even when no visible detail worksheet survives an export.
// contoh_input/06. DT TJ - Jun 2026.xlsx is exactly this case: only a pivot sheet is visible, but
// its cache holds the same 490-row/59-column dataset as contoh_input/06. DT TJ JUN 2026 R1.xlsx's
// visible detail sheet (cross-checked: grouping the recovered records by "Review TJ" reproduces
// the pivot's own totals exactly — TMM=473933.51, TA=1653.24, TE=84.36, Ask TA=40393.29). When a
// cache is present and its own field names satisfy the REQ-RDT-EXT-01 contract, this produces full
// DETAIL_ROW rows through the exact same buildDetailRow rules as a live sheet — not the coarser
// PIVOT_DERIVED aggregate.
async function deriveDetailRowsFromPivotCache(filePath, mapping, exclusions, uploaderDinas, sheetNameHint, dinasCodes) {
  const caches = await readPivotCaches(filePath);
  const rows = [];
  for (const cache of caches) {
    const fieldNames = cache.fields.map((f) => f.name);
    const fieldNamesLower = new Set(fieldNames.map((n) => n.toLowerCase()));
    const needed = ['Account', 'Cost Ctr', 'Profit Ctr', 'Value Date'];
    const hasNeeded = needed.every((k) => fieldNamesLower.has(k.toLowerCase()));
    if (!hasNeeded) continue; // this cache isn't ala-TB shaped either — leave it to the pivot-aggregate fallback

    const keyToFieldName = resolveContractKeys(fieldNames, CONTRACT_FIELDS);
    if (!keyToFieldName.in_pclc) continue; // no nominal field — nothing usable here

    const remarkField = fieldNames.find((n) => n.toLowerCase().startsWith('remark'));
    // "GL" (category) itself is missing from some dinas's shape entirely — TJ's cache has no "GL"
    // field at all, but carries the identical category vocabulary (verified against
    // contoh_input/06. DT TJ - Jun 2026.xlsx: "Sub Group" values are exactly "Repairable-Material",
    // "Spare parts scrap", "Repairable parts-Subcont", "Rotable part", "Rotable parts-Subcont",
    // "Meeting and Conference" — the same strings TB's own "GL" column resolves to via its
    // XLOOKUP, e.g. "Repairable-Material"/"Spare parts scrap") under a differently-named field.
    // Without this fallback every TJ row's category stays null even though the source data has it.
    const glField = fieldNames.find((n) => n.toLowerCase() === 'gl')
      || fieldNames.find((n) => n.toLowerCase() === 'sub group');
    const reviewField = fieldNames.find((n) => n.toLowerCase().startsWith('review'));
    const coveredFields = new Set([...Object.values(keyToFieldName).filter(Boolean), remarkField, glField, reviewField]);

    cache.records.forEach((record, idx) => {
      const fieldValues = {};
      CONTRACT_FIELDS.forEach((ex) => {
        fieldValues[ex.key] = keyToFieldName[ex.key] ? record[keyToFieldName[ex.key]] : null;
      });

      const remark = remarkField ? record[remarkField] : null;
      const reviewRaw = reviewField ? record[reviewField] : null;
      const gl = glField ? record[glField] : null;

      // raw_payload: any cache field outside the 53-column contract and the special routing/
      // category columns already surfaced above — mirrors the live-sheet path's "everything after
      // Value Date" catch-all, but by name since cache fields have no fixed column position.
      const rawPayload = {};
      fieldNames.forEach((name) => {
        if (coveredFields.has(name)) return;
        rawPayload[name] = record[name];
      });

      rows.push(buildDetailRow({
        sheetName: sheetNameHint || 'pivot-cache',
        rowNumber: idx + 1,
        fieldValues,
        remark,
        reviewRaw,
        gl,
        mapping,
        exclusions,
        uploaderDinas,
        granularity: 'DETAIL_ROW',
        rawPayload,
        dinasCodes,
      }));
    });
  }
  return rows;
}

async function parseExcelFile(filePath, options = {}) {
  const mapping = loadJSON('mapping.seed.json');
  const exclusions = loadJSON('exclusions.config.json');
  const dinasCodes = (loadJSON('dinas.codes.json').codes) || [];
  const uploaderDinas = options.uploaderDinas || null;

  const workbook = new ExcelJS.Workbook();
  // use xlsx readFile which preserves formula result in cell.value.result
  await workbook.xlsx.readFile(filePath);

  const results = [];
  // REQ-RDT-EXT-09: tracked across the whole workbook so we know, only once every sheet has been
  // visited, whether the ala-TB detail path (jalur 1) found anything at all — the pivot fallback
  // (jalur 2) only kicks in when it didn't.
  let anyDetailSheetFound = false;
  const pivotSheets = [];

  workbook.eachSheet((worksheet, sheetId) => {
    // REQ-RDT-EXT-07 CORRECTION (26 Jul, project owner request): dropped the sheet-NAME check
    // ("summary" substring) entirely — verified empirically that it was always redundant. TB's
    // own pivot sheet is literally named "DT TB - June 2026" (no "summary" in it at all) and was
    // only ever caught by the A3 check; R1's "Summary"-named pivot ALSO independently matches A3.
    // So the name check never actually did anything across any of the 3 known real files — pure
    // dead weight that risked false-catching an unrelated sheet whose name happens to contain
    // "summary". Pivot detection now relies purely on cell content, with two anchors instead of
    // one: A3="Sum of In PCLC" (as before) OR A4="Row Labels" — both verified identical in TB's
    // pivot AND both TJ pivots (contoh_input/06. DT TJ - Jun 2026.xlsx and R1's Summary sheet).
    // "Row Labels"/"Column Labels" are Excel PivotTable's own generated boilerplate labels (not
    // dinas-specific), so A4 is a second anchor that survives even if a future dinas's pivot sums
    // a differently-named value field (i.e. not literally "Sum of In PCLC").
    const a3Value = readCellValue(worksheet.getCell('A3'));
    const a4Value = readCellValue(worksheet.getCell('A4'));
    const isPivotSheet = String(a3Value || '').trim() === 'Sum of In PCLC' || String(a4Value || '').trim() === 'Row Labels';
    if (isPivotSheet) { pivotSheets.push(worksheet); return; }

    // read header row first (assume row 1)
    const headerRow = worksheet.getRow(1);
    // build headerIndex as mapping: headerName -> array of column numbers
    // use the actual colNumber provided by exceljs to avoid shifting when there are empty header cells
    const headerIndex = {};
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = readCellValue(cell);
      const name = String(val || '').trim();
      // store positions for duplicate headers too; do not overwrite
      if (name) {
        headerIndex[name] = headerIndex[name] || [];
        headerIndex[name].push(colNumber);
      }
    });

    // convenience: set of header names lowercased for detection
    const headerNamesLower = new Set(Object.keys(headerIndex).map((h) => h.toLowerCase()));

    const needed = ['Account', 'Cost Ctr', 'Profit Ctr', 'Value Date'];
    const hasNeeded = needed.every((k) => headerNamesLower.has(k.toLowerCase()));
    if (!hasNeeded) {
      // REQ-RDT-EXT-01 CORRECTION (25 Jul, verified by opening the real
      // contoh_input/06. DT TJ JUN 2026 R1.xlsx directly and cross-checking against its own
      // Summary pivot): TJ-TE/TJ-TMM/TJ-Scrap (Cost.Ctr1/Cost.Element/Amount/Curr./Cost.Ctr2/
      // Qty/UoM/Text shaped sheets) are NOT additional transactions — they are a per-destination
      // reconciliation breakdown of rows ALREADY on the main sheet, routed via its own "Review
      // TJ" column. Proof: every single TJ-TMM row's amount exactly matches an amount among the
      // main sheet's Review-TJ="TMM" rows (321/321 matched), and TJ-TE/TJ-Scrap's sheet totals
      // (84.36 / 1653.24) exactly equal the main sheet's own Review-TJ="TE"/"TA" row sums — with
      // nothing left over. The main sheet's Review TJ column alone reproduces the pivot's Grand
      // Total (516,064.40) exactly across all 4 real destinations (TMM/TA/TE/"Ask TA").
      // Extracting these sheets as a second, separate transaction source (as an earlier session
      // did, based on an incomplete/cached read of the pivot) double-counted every one of these
      // rows — confirmed against a live screenshot of the resulting bug (TM shown as 797,421.97,
      // exactly 473,933.51 + the TJ-TMM sheet's own 323,488.46 duplicate). So: treat these
      // exactly like an actual lookup/reference sheet (e.g. TB's SQ00/ziw29/po/WBS/IW38/GL) and
      // just skip them — the main sheet's own Remarks/Review-column routing is already complete.
      return;
    }
    anyDetailSheetFound = true;

    // helper: build position->name map from headerIndex
    const posName = {};
    Object.keys(headerIndex).forEach(name => headerIndex[name].forEach(col => { posName[col] = name; }));
    const maxCol = Math.max(0, ...Object.keys(posName).map(Number));

    // map CONTRACT_FIELDS headers to column numbers by scanning positions
    const headerPos = {};
    let scanCol = 1;
    for (let i = 0; i < CONTRACT_FIELDS.length; i++) {
      const ex = CONTRACT_FIELDS[i];
      let found = undefined;
      for (let c = scanCol; c <= maxCol; c++) {
        const h = posName[c] || '';
        if (!h) continue;
        const hl = h.toLowerCase();
        if (ex.variants.some(v => v.toLowerCase() === hl)) { found = c; scanCol = c+1; break; }
      }
      headerPos[ex.key] = found; // may be undefined if missing
    }

    const inPCLCCol = headerPos['in_pclc'];
    const remarksCol = (function(){
      // find any header that matches Remarks/Remark (may be after or before)
      for (const name of Object.keys(headerIndex)) {
        if (name.toLowerCase().startsWith('remark')) return headerIndex[name][0];
      }
      return undefined;
    })();
    // Same "GL" (category) fallback as the pivot-cache path above (deriveDetailRowsFromPivotCache) —
    // a dinas's live sheet may carry the category under "Sub Group" instead of a literal "GL" column.
    const glCol = (function(){
      for (const name of Object.keys(headerIndex)) {
        if (name.toLowerCase() === 'gl') return headerIndex[name][0];
      }
      for (const name of Object.keys(headerIndex)) {
        if (name.toLowerCase() === 'sub group') return headerIndex[name][0];
      }
      return undefined;
    })();
    // REQ-RDT-EXT-XX (found via contoh_input/06. DT TJ - Jun 2026.xlsx, confirmed by project
    // owner 24 Jul): some dinas route via a "Review <dinas>" column instead of Remarks — e.g.
    // TJ's "Review TJ" (values like "TMM", "TA", "TE", "Ask TA", recovered from that file's
    // pivot cache since the sheet ships only as a pivot in that particular export). Only used as
    // a FALLBACK when Remarks is empty — never overrides an existing Remarks value — so this
    // can't change TB's already-verified behavior.
    const reviewCol = (function(){
      for (const name of Object.keys(headerIndex)) {
        if (name.toLowerCase().startsWith('review')) return headerIndex[name][0];
      }
      return undefined;
    })();

    if (!inPCLCCol) {
      // no nominal column — mark all rows invalid in this sheet
      return;
    }

    // raw_payload covers every column NOT already surfaced as a named field — by column NUMBER
    // (not just "after Value Date"), so leading columns the 53-field contract doesn't recognize
    // (e.g. R1's "Group"/"Sub Group" at columns 1-2, before "Account") are captured too instead of
    // silently dropped. Mirrors the pivot-cache path's by-NAME equivalent (deriveDetailRowsFromPivotCache's
    // coveredFields), which never had this gap since it was never position-based to begin with.
    const coveredCols = new Set(Object.values(headerPos).filter(Boolean));
    if (remarksCol) coveredCols.add(remarksCol);
    if (glCol) coveredCols.add(glCol);
    if (reviewCol) coveredCols.add(reviewCol);
    const lastCol = Math.max(maxCol, worksheet.columnCount || 0);

    // iterate data rows
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      function cellAt(posKey) {
        const col = headerPos[posKey];
        return col ? readCellValue(row.getCell(col)) : null;
      }
      const fieldValues = {};
      CONTRACT_FIELDS.forEach((ex) => { fieldValues[ex.key] = cellAt(ex.key); });

      const remark = remarksCol ? readCellValue(row.getCell(remarksCol)) : null;
      const reviewRaw = reviewCol ? readCellValue(row.getCell(reviewCol)) : null;
      const gl = glCol ? readCellValue(row.getCell(glCol)) : null;

      const rawPayload = {};
      for (let c = 1; c <= lastCol; c++) {
        if (coveredCols.has(c)) continue;
        const headerName = posName[c] || `col_${c}`;
        rawPayload[headerName] = readCellValue(row.getCell(c));
      }

      results.push(buildDetailRow({
        sheetName: worksheet.name,
        rowNumber,
        fieldValues,
        remark,
        reviewRaw,
        gl,
        mapping,
        exclusions,
        uploaderDinas,
        granularity: 'DETAIL_ROW',
        rawPayload,
        dinasCodes,
      }));
    });
  });

  // No ala-TB detail sheet found anywhere in the workbook. Try the richer fallback first (jalur
  // 1b): recover full DETAIL_ROW rows from the workbook's pivot cache, if it has one and that
  // cache satisfies the same header contract. Only if that yields nothing does this drop to the
  // coarse PIVOT_DERIVED aggregate (jalur 2) instead of returning an empty result.
  if (!anyDetailSheetFound) {
    const cacheRows = pivotSheets.length > 0
      ? await deriveDetailRowsFromPivotCache(filePath, mapping, exclusions, uploaderDinas, pivotSheets[0].name, dinasCodes)
      : [];
    if (cacheRows.length > 0) {
      results.push(...cacheRows);
    } else {
      pivotSheets.forEach((worksheet) => {
        results.push(...derivePivotRowsFromSheet(worksheet, mapping, exclusions, uploaderDinas, dinasCodes));
      });
    }
  }

  return results;
}

module.exports = {
  parseExcelFile,
  // REQ-RDT-SAP-06 (29 Jul): routes/exportBatches.js's full-53-column per-pair export reuses this
  // for real contract header labels (Account, Cost Ctr, ...) instead of guessing/retyping them.
  CONTRACT_FIELDS,
};
