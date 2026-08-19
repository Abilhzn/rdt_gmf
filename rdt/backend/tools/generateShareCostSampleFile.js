#!/usr/bin/env node
// Generates a sample Detail Transaction Excel file (softfile) demonstrating the Share-Cost
// scenario: one dinas's monthly upload where every row routes to dinas_target='TAB' via
// Remarks (see excelParser.js's rawPrefix derivation + Share-Cost's GET /candidates, which is
// scoped to exactly dinas_target='TAB'). Header/column layout copied from a real verified
// upload (contoh_input/06. DT TB - Jun 2026.xlsx's "Material" sheet) so this parses/persists
// through the normal /api/parse + /api/persist flow like any real dinas file.
// Run: node tools/generateShareCostSampleFile.js
'use strict';
const path = require('path');
const ExcelJS = require('exceljs');

// Same 63-column header as a real detail sheet — order matters, the parser matches by name.
const HEADER = [
  'Account', 'Cost Ctr', 'Profit Ctr', 'Partner PC', 'DocumentNo', 'Ref.Doc.', 'Period', 'Text',
  'Acc.Text', 'User', 'Sales Doc.', 'WBS Elem.', 'Purch.Doc.', 'Order', 'Year', 'Elim.PrCtr',
  'ObjCl', 'Customer', 'Vendor', 'Plant', 'Material', 'Time', 'Year', 'Ref.Org Un', 'ValA', 'MvT',
  'Type', 'Sales Ord.', 'SNo.', 'BusA', 'Func. Area', 'Acty', 'Asset', 'Rep. mat.', 'Ar.', 'DT',
  'Ref. Tran.', 'Item', 'BillT', 'SD Doc.', 'SGrp', 'SOff.', 'COAr', 'In PCLC', 'Curr.',
  'Doc. Date', 'Pstng Date', 'In CCC', 'In TC', 'Qty', 'Unit', 'Entry Dte', 'Value Date', 'Order',
  'WBS', 'ACREG', 'Type Main', 'Notif', 'Document', 'Interval', 'Dinas', 'Remarks', 'GL',
];

// Uploading dinas is TC — dinas_inisiasi follows the uploader, so every row below lands as
// TC -> TAB once parsed/persisted (one file = one dinas's report, same as any real upload).
const UPLOADER_DINAS = 'TC';
const PERIOD = '006';

const ROWS = [
  { account: '40021005', ref_doc: '1900099001', text: 'Sewa alat bersama TC/TAB', nominal: 12500000, remark: 'TAB - Sewa alat bersama TC/TAB' },
  { account: '40011000', ref_doc: '4910099002', text: 'Biaya konsumsi rapat gabungan', nominal: 8750000, remark: 'TAB - Biaya konsumsi rapat gabungan' },
  { account: '40014200', ref_doc: '5105099003', text: 'Cetak dokumen bersama', nominal: 3200000, remark: 'TAB - Cetak dokumen bersama' },
  { account: '40000500', ref_doc: '1005099004', text: 'Sewa kendaraan operasional bersama', nominal: 21000000, remark: 'TAB - Sewa kendaraan operasional bersama' },
];

async function build() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Material');
  ws.addRow(HEADER);
  for (const r of ROWS) {
    const row = new Array(HEADER.length).fill('');
    row[0] = r.account;       // Account
    row[1] = 'GMFTCN';        // Cost Ctr (placeholder, matches real files' naming convention)
    row[2] = 'ZGMFTCW';       // Profit Ctr
    row[5] = r.ref_doc;       // Ref.Doc.
    row[6] = PERIOD;          // Period
    row[7] = r.text;          // Text
    row[43] = r.nominal;      // In PCLC (col 44, 0-indexed 43)
    row[44] = 'USD';          // Curr.
    row[52] = new Date();     // Value Date (col 53) — just needs to be present
    row[60] = UPLOADER_DINAS; // Dinas
    row[61] = r.remark;       // Remarks — drives dinas_target derivation
    ws.addRow(row);
  }
  return wb;
}

if (require.main === module) {
  build().then(async (wb) => {
    const out = path.join(__dirname, '..', '..', 'contoh_input', '07. DT TC - Share-Cost Demo Jun 2026.xlsx');
    await wb.xlsx.writeFile(out);
    console.log(`Wrote ${out}`);
  });
}

module.exports = { build, UPLOADER_DINAS, ROWS };
