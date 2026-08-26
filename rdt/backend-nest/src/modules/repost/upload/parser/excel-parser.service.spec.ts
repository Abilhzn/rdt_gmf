import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { RowStatus } from '../../../../core/enums/row-status.enum';
import { DetailRow } from '../../../../core/interfaces/detail-row.interface';
import { ExcelParserService } from './excel-parser.service';

// Port dari rdt/backend/test/parser.test.js (parser Format CBO, rewrite 20 Agu — pivot-cache/
// kontrak 53-kolom lama sudah dibuang). Angka & status HARUS identik dengan versi lama.
const CONTOH_INPUT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'contoh_input',
);

jest.setTimeout(60000);

function pendingByTarget(rows: DetailRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  rows
    .filter((r) => r.status_konfirmasi === RowStatus.PENDING)
    .forEach((r) => {
      const target = r.dinas_target as string;
      out[target] =
        Math.round(((out[target] || 0) + Number(r.nominal || 0)) * 100) / 100;
    });
  return out;
}

async function buildFormatCboWorkbook(
  dataRows: (string | number)[][],
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Format CBO');
  ws.addRow([
    'Requester',
    'Account',
    'Detail Group',
    'Profit Ctr',
    'Ref.Doc.',
    'Period',
    'Text',
    'Material',
    'In PCLC',
    'Curr.',
    'Remarks',
    'Recipient',
  ]);
  dataRows.forEach((r) => ws.addRow(r));
  const tmpPath = path.join(
    os.tmpdir(),
    `parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`,
  );
  await wb.xlsx.writeFile(tmpPath);
  return tmpPath;
}

describe('ExcelParserService (Format CBO)', () => {
  const parser = new ExcelParserService();

  it('TB Format CBO sheet: dinas_target read directly from Recipient, all rows PENDING', async () => {
    const file = path.join(CONTOH_INPUT_DIR, '06. DT TB - Jun 2026.xlsx');
    const rows = await parser.parseFile(file, { uploaderDinas: 'TB' });
    expect(rows.length).toBe(469);
    expect(rows.every((r) => r.status_konfirmasi === RowStatus.PENDING)).toBe(
      true,
    );
    expect(pendingByTarget(rows)).toEqual({
      TC: 94732.21,
      TF: 360.21,
      TJ: 46353.37,
      TL: 112867.35,
      TN: 860.64,
      Corp: 3294.95,
    });
  });

  it('TJ Format CBO sheet: "Ask TA" Recipient gets NEEDS_INVESTIGATION, rest resolve to real dinas', async () => {
    const file = path.join(CONTOH_INPUT_DIR, '06. DT TJ - Jun 2026.xlsx');
    const rows = await parser.parseFile(file, { uploaderDinas: 'TJ' });
    expect(rows.length).toBe(490);
    expect(pendingByTarget(rows)).toEqual({
      TE: 84.36,
      TMM: 473933.51,
      TA: 1653.24,
    });

    const investigationRows = rows.filter(
      (r) => r.status_konfirmasi === RowStatus.NEEDS_INVESTIGATION,
    );
    expect(investigationRows.length).toBe(3);
    expect(
      Math.round(
        investigationRows.reduce((s, r) => s + Number(r.nominal || 0), 0) * 100,
      ) / 100,
    ).toBeCloseTo(40393.29, 2);
    expect(investigationRows.every((r) => !r.dinas_target)).toBe(true);
    expect(
      rows.some((r) => r.status_konfirmasi === RowStatus.NEEDS_REVIEW),
    ).toBe(false);
  });

  it('unrecognized Recipient value gets NEEDS_REVIEW with an explanatory reason', async () => {
    const tmpPath = await buildFormatCboWorkbook([
      [
        'TC',
        '40021005',
        'Expendable-Material',
        'ZGMFTCW',
        '1900099001',
        '006',
        'test',
        '',
        100,
        'USD',
        '',
        'NOTADINAS',
      ],
    ]);
    const rows = await parser.parseFile(tmpPath, { uploaderDinas: 'TC' });
    fs.unlinkSync(tmpPath);

    expect(rows.length).toBe(1);
    expect(rows[0].status_konfirmasi).toBe(RowStatus.NEEDS_REVIEW);
    expect(rows[0].dinas_target).toBeNull();
    expect(rows[0].reason_if_invalid).toMatch(/NOTADINAS/);
  });

  it('Requester === Recipient (same dinas on both, case-insensitive) gets EXCLUDED', async () => {
    const tmpPath = await buildFormatCboWorkbook([
      [
        'TC',
        '40021005',
        'Expendable-Material',
        'ZGMFTCW',
        '1900099001',
        '006',
        'test',
        '',
        100,
        'USD',
        '',
        'TC',
      ],
      [
        'tc',
        '40021005',
        'Expendable-Material',
        'ZGMFTCW',
        '1900099001',
        '006',
        'test',
        '',
        50,
        'USD',
        '',
        'TC',
      ],
    ]);
    const rows = await parser.parseFile(tmpPath, { uploaderDinas: 'TAB' });
    fs.unlinkSync(tmpPath);

    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status_konfirmasi === RowStatus.EXCLUDED)).toBe(
      true,
    );
  });
});
