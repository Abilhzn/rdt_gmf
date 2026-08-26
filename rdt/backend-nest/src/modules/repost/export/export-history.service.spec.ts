import { DatabaseService } from '../../../core/database/database.service';
import type { Identity } from '../../../core/security/identity.interface';
import { ExportHistoryService } from './export-history.service';

function fakeDb(queue: unknown[]) {
  const query = jest.fn(() => Promise.resolve(queue.shift()));
  const db = { query } as unknown as DatabaseService;
  return { db, query };
}

const tabUser: Identity = { userId: 'tab-1', dinas: 'Corp', role: 'TAB' };
const dinasUser: Identity = { userId: 'u-tb', dinas: 'TB', role: 'staff' };

describe('ExportHistoryService.getHistory — scoping', () => {
  test('TAB sees batches across every dinas (no dinas filter in the WHERE)', async () => {
    const { db, query } = fakeDb([
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
      { rows: [] }, // subdocs
      { rows: [] }, // declared period
      { rows: [] }, // effective period
    ]);
    const service = new ExportHistoryService(db);

    const batches = await service.getHistory(tabUser);
    expect(batches).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).not.toContain('dinas_inisiasi = $1');
    expect(params).toEqual([]);
  });

  test('non-TAB is force-scoped to dinas_inisiasi=user.dinas -- no dinas param the caller can override', async () => {
    const { db, query } = fakeDb([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const service = new ExportHistoryService(db);

    await service.getHistory(dinasUser);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('b.dinas_inisiasi = $1');
    expect(params).toEqual(['TB']); // user.dinas, never anything caller-supplied
  });
});

describe('ExportHistoryService.getHistory — derivation', () => {
  test('period = modus (most-common) declared period, period_efektif = MAX, overdue when they differ', async () => {
    const { db } = fakeDb([
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
      {
        rows: [
          {
            id: 10,
            batch_id: 1,
            subdoc_number: 'SAP-1',
            created_at: '2026-08-01T00:00:00Z',
            transaction_ids: [100, 101],
          },
        ],
      },
      { rows: [{ batch_id: 1, period: '2026-07', c: 5 }] },
      { rows: [{ batch_id: 1, max_effective: '2026-08' }] }, // shifted away from declared -> overdue
    ]);
    const service = new ExportHistoryService(db);

    const [batch] = await service.getHistory(tabUser);
    expect(batch.period).toBe('2026-07');
    expect(batch.period_efektif).toBe('2026-08');
    expect(batch.overdue).toBe(true);
    expect(batch.subdocs).toEqual([
      {
        id: 10,
        subdoc_number: 'SAP-1',
        created_at: '2026-08-01T00:00:00Z',
        transaction_ids: [100, 101],
      },
    ]);
    expect(batch.subdoc_numbers).toEqual(['SAP-1']);
    expect(batch.state_label).toContain('SAP-1'); // deriveStateLabel(3a): "Reposted by TAB with subdoc ..."
  });

  test('period_efektif falls back to the declared period when no snapshot exists yet (NULL)', async () => {
    const { db } = fakeDb([
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
      { rows: [] },
      { rows: [{ batch_id: 1, period: '2026-07', c: 3 }] },
      { rows: [{ batch_id: 1, max_effective: null }] },
    ]);
    const service = new ExportHistoryService(db);

    const [batch] = await service.getHistory(tabUser);
    expect(batch.period).toBe('2026-07');
    expect(batch.period_efektif).toBe('2026-07');
    expect(batch.overdue).toBe(false);
  });

  test('a batch with 2 subdocs: subdocs array has 2 ordered entries, each with its own transaction_ids', async () => {
    const { db } = fakeDb([
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
      {
        rows: [
          {
            id: 10,
            batch_id: 1,
            subdoc_number: 'SAP-1',
            created_at: '2026-08-01T00:00:00Z',
            transaction_ids: [100, 101],
          },
          {
            id: 11,
            batch_id: 1,
            subdoc_number: 'SAP-2',
            created_at: '2026-08-02T00:00:00Z',
            transaction_ids: [102],
          },
        ],
      },
      { rows: [{ batch_id: 1, period: '2026-07', c: 3 }] },
      { rows: [{ batch_id: 1, max_effective: '2026-07' }] },
    ]);
    const service = new ExportHistoryService(db);

    const [batch] = await service.getHistory(tabUser);
    expect(batch.subdocs.map((s) => s.subdoc_number)).toEqual([
      'SAP-1',
      'SAP-2',
    ]);
    const allCovered = batch.subdocs.flatMap((s) => s.transaction_ids);
    expect(allCovered.sort((a, b) => a - b)).toEqual([100, 101, 102]);
  });
});

describe('ExportHistoryService.getHistory — periode filter', () => {
  test('applied AFTER derivation, against period_efektif||period, excludes non-matching batches', async () => {
    const { db } = fakeDb([
      {
        rows: [
          { id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' },
          { id: 2, dinas_inisiasi: 'TB', dinas_target: 'TE' },
        ],
      },
      { rows: [] }, // subdocs (none for either, keeps this test focused on the filter)
      {
        rows: [
          { batch_id: 1, period: '2026-07', c: 1 },
          { batch_id: 2, period: '2026-06', c: 1 },
        ],
      },
      { rows: [] }, // no effective snapshots -> falls back to declared period
    ]);
    const service = new ExportHistoryService(db);

    const filtered = await service.getHistory(tabUser, '2026-07');
    expect(filtered.map((b) => b.id)).toEqual([1]);
  });
});
