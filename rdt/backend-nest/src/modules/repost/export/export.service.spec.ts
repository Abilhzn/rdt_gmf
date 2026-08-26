import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { ExportService } from './export.service';
import {
  ExportPayload,
  FormatTabExportService,
} from './format-tab-export.service';

function fakeDb(queue: unknown[]) {
  const query = jest.fn(() => Promise.resolve(queue.shift()));
  const db = { query } as unknown as DatabaseService;
  return { db, query };
}

function fakeFormatTab() {
  const payload: ExportPayload = {
    filename: 'f.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('xlsx'),
  };
  const buildExportPayload = jest
    .fn<Promise<ExportPayload>, unknown[]>()
    .mockResolvedValue(payload);
  return {
    formatTab: { buildExportPayload } as unknown as FormatTabExportService,
    buildExportPayload,
    payload,
  };
}

describe('ExportService.getWaiting', () => {
  test('includes a pair with zero BLOCKING rows, excludes one with any PENDING left', async () => {
    const { db } = fakeDb([
      {
        rows: [
          // TB->TC: all ATTACHABLE -> should appear
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            status_konfirmasi: 'CONFIRMED',
            declared_period: '2026-07',
            periode_efektif: '2026-07',
          },
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            status_konfirmasi: 'BORNE_BY_INITIATOR',
            declared_period: '2026-07',
            periode_efektif: '2026-07',
          },
          // TJ->TE: still has a PENDING row -> excluded
          {
            dinas_inisiasi: 'TJ',
            dinas_target: 'TE',
            status_konfirmasi: 'PENDING',
            declared_period: '2026-07',
            periode_efektif: null,
          },
          {
            dinas_inisiasi: 'TJ',
            dinas_target: 'TE',
            status_konfirmasi: 'CONFIRMED',
            declared_period: '2026-07',
            periode_efektif: '2026-07',
          },
        ],
      },
    ]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const waiting = await service.getWaiting();

    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      dinas_inisiasi: 'TB',
      dinas_target: 'TC',
      total: 2,
      overdue: false,
    });
  });

  test('overdue: true when periode_efektif has shifted away from the majority declared period', async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            status_konfirmasi: 'CONFIRMED',
            declared_period: '2026-07',
            periode_efektif: '2026-08', // shifted -> overdue
          },
        ],
      },
    ]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const waiting = await service.getWaiting();
    expect(waiting[0].overdue).toBe(true);
  });

  test('results sorted by dinas_inisiasi+dinas_target', async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            dinas_inisiasi: 'TZ',
            dinas_target: 'TA',
            status_konfirmasi: 'CONFIRMED',
            declared_period: '2026-07',
            periode_efektif: '2026-07',
          },
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            status_konfirmasi: 'CONFIRMED',
            declared_period: '2026-07',
            periode_efektif: '2026-07',
          },
        ],
      },
    ]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const waiting = await service.getWaiting();
    expect(waiting.map((w) => w.dinas_inisiasi)).toEqual(['TB', 'TZ']);
  });
});

describe('ExportService.getBatchLines / getTransparency', () => {
  test('getBatchLines queries by export_batch_id, ordered by id', async () => {
    const { db, query } = fakeDb([{ rows: [{ id: 1, subdoc_number: null }] }]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const lines = await service.getBatchLines(42);
    expect(lines).toEqual([{ id: 1, subdoc_number: null }]);
    expect(query.mock.calls[0][1]).toEqual([42]);
  });

  test('getTransparency scopes to one pair, unbatched, BLOCKING+ATTACHABLE only', async () => {
    const { db, query } = fakeDb([
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
    ]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const rows = await service.getTransparency('TB', 'TC');
    expect(rows).toHaveLength(1);
    const call = query.mock.calls[0];
    expect(call[1]).toEqual([
      'TB',
      'TC',
      [
        'PENDING',
        'DECLINED',
        'NEEDS_REVIEW',
        'CONFIRMED',
        'BORNE_BY_INITIATOR',
      ],
    ]);
  });
});

describe('ExportService.exportBatch / exportPair', () => {
  test('exportBatch: batch not found -> 404', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    await expect(service.exportBatch(999)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'EXPORT_BATCH_NOT_FOUND',
    });
  });

  test('exportBatch: resolves pair off the batch row, delegates buffer-building to FormatTabExportService', async () => {
    const { db, query } = fakeDb([
      { rows: [{ dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
      {
        rows: [
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            account: 'A',
            nominal: 100,
            curr: 'IDR',
            ref_doc: 'R',
            period: '2026-07',
          },
        ],
      },
    ]);
    const { formatTab, buildExportPayload, payload } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    const result = await service.exportBatch(1);
    expect(result).toBe(payload);
    expect(buildExportPayload).toHaveBeenCalledWith(
      [
        {
          dinas_inisiasi: 'TB',
          dinas_target: 'TC',
          account: 'A',
          nominal: 100,
          curr: 'IDR',
          ref_doc: 'R',
          period: '2026-07',
        },
      ],
      'TB',
      'TC',
    );
    const insertCall = query.mock.calls[1];
    expect(String(insertCall[0])).toContain("status_konfirmasi='CONFIRMED'");
  });

  test('exportPair: reads straight off the pair (export_batch_id IS NULL), no batch lookup', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { formatTab, buildExportPayload } = fakeFormatTab();
    const service = new ExportService(db, formatTab);

    await service.exportPair('TB', 'TC');
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0];
    expect(String(call[0])).toContain('export_batch_id IS NULL');
    expect(String(call[0])).toContain("status_konfirmasi='CONFIRMED'");
    expect(buildExportPayload).toHaveBeenCalledWith([], 'TB', 'TC');
  });
});

describe('DomainError sanity (export not found)', () => {
  test('is thrown as an actual DomainError instance', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const { formatTab } = fakeFormatTab();
    const service = new ExportService(db, formatTab);
    await expect(service.exportBatch(1)).rejects.toBeInstanceOf(DomainError);
  });
});
