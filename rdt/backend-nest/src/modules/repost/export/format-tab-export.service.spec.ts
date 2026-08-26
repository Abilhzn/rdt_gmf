import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  FormatTabExportService,
  FormatTabRow,
  MAX_ROWS_PER_FILE,
} from './format-tab-export.service';

function row(overrides: Partial<FormatTabRow> = {}): FormatTabRow {
  return {
    dinas_inisiasi: 'TB',
    dinas_target: 'TC',
    account: '40011000',
    nominal: 1234.5,
    curr: 'IDR',
    ref_doc: 'REF-1',
    period: '2026-07',
    ...overrides,
  };
}

describe('FormatTabExportService.buildWorkbookBuffer — Format TAB 8-kolom', () => {
  test('exact headers (incl. "Text " trailing space), Qty=1, UoM=EA, text = 4-field concat', async () => {
    const service = new FormatTabExportService();
    const buffer = await service.buildWorkbookBuffer([row()]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Format TAB')!;
    const headerRow = sheet.getRow(1).values as unknown[];
    // ExcelJS row.values is 1-indexed with a leading empty slot
    expect(headerRow.slice(1)).toEqual([
      'Requester',
      'Cost.Element',
      'Amount',
      'Curr.',
      'Recipient',
      'Qty',
      'UoM',
      'Text ',
    ]);

    const dataRow = sheet.getRow(2).values as unknown[];
    const [, requester, costElement, amount, curr, recipient, qty, uom, text] =
      dataRow;
    expect(requester).toBe('TB');
    expect(costElement).toBe('40011000');
    expect(amount).toBe(1234.5);
    expect(curr).toBe('IDR');
    expect(recipient).toBe('TC');
    expect(qty).toBe(1);
    expect(uom).toBe('EA');
    expect(text).toBe('TB to TC REF-1 2026-07');
  });

  test('missing fields fall back to empty string in the text concat, not "undefined"/"null"', async () => {
    const service = new FormatTabExportService();
    const buffer = await service.buildWorkbookBuffer([
      row({ dinas_target: null, ref_doc: undefined, period: null }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Format TAB')!;
    const text = (sheet.getRow(2).values as unknown[])[8];
    expect(text).toBe('TB to   '); // dinas_target/ref_doc/period all empty (3 blank joins)
  });
});

describe('FormatTabExportService.buildExportPayload — chunking/zip', () => {
  test('<=300 rows -> single .xlsx attachment', async () => {
    const service = new FormatTabExportService();
    const rows = Array.from({ length: MAX_ROWS_PER_FILE }, () => row());
    const payload = await service.buildExportPayload(rows, 'TB', 'TC');

    expect(payload.filename).toMatch(
      /^TB-TC_\d{4}-\d{2}-\d{2}_FormatTAB\.xlsx$/,
    );
    expect(payload.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(payload.buffer);
    expect(workbook.getWorksheet('Format TAB')!.rowCount).toBe(
      MAX_ROWS_PER_FILE + 1,
    ); // + header
  });

  test('>300 rows -> .zip of several ordered chunk-N.xlsx, order preserved (slice, not re-sort)', async () => {
    const service = new FormatTabExportService();
    // 301 rows tagged with a distinguishable ref_doc so we can verify slice order survives.
    const rows = Array.from({ length: MAX_ROWS_PER_FILE + 1 }, (_, i) =>
      row({ ref_doc: `R${i}` }),
    );
    const payload = await service.buildExportPayload(rows, 'TB', 'TC');

    expect(payload.filename).toMatch(
      /^TB-TC_\d{4}-\d{2}-\d{2}_FormatTAB\.zip$/,
    );
    expect(payload.contentType).toBe('application/zip');

    const zip = await JSZip.loadAsync(payload.buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['chunk-1.xlsx', 'chunk-2.xlsx']);

    const chunk1Buffer = await zip.files['chunk-1.xlsx'].async('nodebuffer');
    const wb1 = new ExcelJS.Workbook();
    await wb1.xlsx.load(chunk1Buffer);
    const sheet1 = wb1.getWorksheet('Format TAB')!;
    expect(sheet1.rowCount).toBe(MAX_ROWS_PER_FILE + 1); // 300 rows + header
    expect((sheet1.getRow(2).values as unknown[])[8]).toContain('R0'); // first row, in order
    expect(
      (sheet1.getRow(MAX_ROWS_PER_FILE + 1).values as unknown[])[8],
    ).toContain(`R${MAX_ROWS_PER_FILE - 1}`);

    const chunk2Buffer = await zip.files['chunk-2.xlsx'].async('nodebuffer');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(chunk2Buffer);
    const sheet2 = wb2.getWorksheet('Format TAB')!;
    expect(sheet2.rowCount).toBe(2); // the 301st row + header
    expect((sheet2.getRow(2).values as unknown[])[8]).toContain(
      `R${MAX_ROWS_PER_FILE}`,
    );
  });
});
