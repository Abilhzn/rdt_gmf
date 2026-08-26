import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';

// SAP's line-item cap is ~300 rows, same as the subdoc limit -- a pair whose CONFIRMED rows
// exceed it can't physically be posted as one file, so it must download as several <=300-row
// files instead of one file TAB has to cut apart by hand. Port faithful dari
// `routes/exportBatches.js`'s streamContractExport/MAX_ROWS_PER_FILE.
export const MAX_ROWS_PER_FILE = 300;

// Baris sumber buat Format TAB -- kolom yang di-SELECT `routes/exportBatches.js`'s
// FORMAT_TAB_SQL_COLS (dinas_inisiasi, dinas_target, account, nominal, curr, ref_doc, period).
export interface FormatTabRow {
  dinas_inisiasi: unknown;
  dinas_target: unknown;
  account: unknown;
  nominal: unknown;
  curr: unknown;
  ref_doc: unknown;
  period: unknown;
}

export interface ExportPayload {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

// Sama seperti `${x || ''}` di JS lama, tapi type-safe: nilai kolom transaksi ini selalu
// primitive di praktiknya, jadi String() aman -- lihat komentar `normalize` di 3.5a's
// duplicate-check.ts buat alasan yang sama.
function textPart(v: unknown): string {
  if (v === null || v === undefined) return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v);
}

/**
 * Bungkus ExcelJS (Boundaries, konsisten `ExcelParserService` Batch 1) -- SATU service buat
 * builder + chunking/zip, dipakai `ExportService` (5 endpoint baca-saja, Batch 4a).
 *
 * ⚠️ Format TAB 8-kolom SAJA -- format 53-kolom "contract" lama (`CONTRACT_FIELDS`,
 * `buildContractWorkbookBuffer`) DIBUANG total, tidak di-port (parser sudah Format CBO, kolom itu yatim).
 */
@Injectable()
export class FormatTabExportService {
  // SRS.md "TERJAWAB 15 Agu" -- output-side mapping saja, dari Format_Detail_Transaksi.xlsx
  // ("Format TAB" sheet, 8 kolom). Field di-RENAME, bukan data baru: Account->Cost.Element,
  // In PCLC->Amount (baca dari `nominal`, nilai yang sudah diproses). Qty/UoM konstan (1/'EA'),
  // bukan turunan baris. "Text " (trailing space verbatim, dari template resmi) = concat 4 field.
  async buildWorkbookBuffer(rows: FormatTabRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Format TAB');
    sheet.columns = [
      { header: 'Requester', key: 'requester', width: 14 },
      { header: 'Cost.Element', key: 'cost_element', width: 16 },
      { header: 'Amount', key: 'amount', width: 16 },
      { header: 'Curr.', key: 'curr', width: 8 },
      { header: 'Recipient', key: 'recipient', width: 14 },
      { header: 'Qty', key: 'qty', width: 6 },
      { header: 'UoM', key: 'uom', width: 6 },
      { header: 'Text ', key: 'text', width: 40 },
    ];
    rows.forEach((row) => {
      sheet.addRow({
        requester: row.dinas_inisiasi,
        cost_element: row.account,
        amount: row.nominal,
        curr: row.curr,
        recipient: row.dinas_target,
        qty: 1,
        uom: 'EA',
        text: `${textPart(row.dinas_inisiasi)} to ${textPart(row.dinas_target)} ${textPart(row.ref_doc)} ${textPart(row.period)}`,
      });
    });
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  // <=300 baris -> satu .xlsx attachment. >300 -> potong per 300 (slice, BUKAN re-sort -- baris
  // sudah `ORDER BY id` dari caller, urutan itu jadi urutan chunk juga, biar "file 1" selaras
  // "subdoc 1" nanti di 4c), tiap potongan .xlsx terpisah, di-zip jadi satu .zip.
  async buildExportPayload(
    rows: FormatTabRow[],
    dinasInisiasi: string,
    dinasTarget: string,
  ): Promise<ExportPayload> {
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseName = `${dinasInisiasi}-${dinasTarget}_${dateStr}_FormatTAB`;

    if (rows.length <= MAX_ROWS_PER_FILE) {
      const buffer = await this.buildWorkbookBuffer(rows);
      return {
        filename: `${baseName}.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
      };
    }

    const zip = new JSZip();
    for (let i = 0; i < rows.length; i += MAX_ROWS_PER_FILE) {
      const chunkIndex = Math.floor(i / MAX_ROWS_PER_FILE) + 1;
      const chunkRows = rows.slice(i, i + MAX_ROWS_PER_FILE);
      const buffer = await this.buildWorkbookBuffer(chunkRows);
      zip.file(`chunk-${chunkIndex}.xlsx`, buffer);
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    return {
      filename: `${baseName}.zip`,
      contentType: 'application/zip',
      buffer: zipBuffer,
    };
  }
}
