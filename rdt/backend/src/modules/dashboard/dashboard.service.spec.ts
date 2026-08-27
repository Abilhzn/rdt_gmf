import { DatabaseService } from '../../core/database/database.service';
import type { Identity } from '../../core/security/identity.interface';
import { DashboardService } from './dashboard.service';

type Handler = (sql: string, params?: unknown[]) => { rows: unknown[] };

// Smart mock: dispatch by matching against the query text (+ params when a query is
// parameterized identically across different call sites, e.g. per-row sub-queries inside a
// Promise.all). Far more robust here than an ordered queue -- the number/order of queries this
// service issues depends on the data itself (early-return guards on empty id arrays, conditional
// sub-queries), which a fixed queue can't express without becoming as complex as the code itself.
function fakeDb(handler: Handler) {
  const query = jest.fn((sql: string, params?: unknown[]) =>
    Promise.resolve(handler(sql, params)),
  );
  const db = { query } as unknown as DatabaseService;
  return { db, query };
}

function txnRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    dinas_inisiasi: 'TJ',
    dinas_target: 'TE',
    status_konfirmasi: 'PENDING',
    reassign_count: 0,
    export_batch_id: null,
    declared_period: '2026-07',
    periode_efektif: null,
    ...overrides,
  };
}

const tabUser: Identity = { userId: 'tab-1', dinas: 'Corp', role: 'TAB' };
const teUser: Identity = { userId: 'u-te', dinas: 'TE', role: 'staff' };

describe('DashboardService (private engine, via getSummary/getBreakdown)', () => {
  test('a fully-reassigned-then-resolved transaction groups under its ORIGINAL target, not the current one', async () => {
    const { db } = fakeDb((sql) => {
      // main chain-aware txn query (groupBy:'target', initiatorDinas: 'TJ')
      if (sql.includes('t.export_batch_id,')) {
        return {
          rows: [
            txnRow({
              id: 10,
              dinas_target: 'TE', // current target after 2 reassigns
              status_konfirmasi: 'CONFIRMED',
              reassign_count: 2,
              export_batch_id: null,
            }),
          ],
        };
      }
      if (sql.includes('rdt.audit_log')) {
        // chain: TJ -> TC (first) -> TL -> TE (current)
        return {
          rows: [
            { transaction_id: 10, detail: { from_dinas: 'TC' } },
            { transaction_id: 10, detail: { from_dinas: 'TL' } },
          ],
        };
      }
      if (sql.includes('rdt.comments')) return { rows: [] };
      if (sql.includes('SELECT id, dinas_inisiasi FROM rdt.transactions'))
        return { rows: [] }; // no NEEDS_INVESTIGATION rows
      // need_to_confirm query + everything else
      return { rows: [] };
    });
    const service = new DashboardService(db);

    const summary = await service.getSummary({
      userId: 'u',
      dinas: 'TJ',
      role: 'staff',
    });

    expect(summary.as_initiator).toHaveLength(1);
    const card = summary.as_initiator[0];
    expect(card.dinas).toBe('TC'); // ORIGINAL target (chain[0]), not TE
    expect(card.resolved).toBe(1);
    expect(card.percent).toBe(100);
    expect(card.chain).toEqual(['TJ', 'TC', 'TL', 'TE']); // full breadcrumb, single txn -> consistent
  });

  test('visibility cutoff: 100% resolved AND fully batched disappears; partially-batched stays', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('t.export_batch_id,')) {
        return {
          rows: [
            // Pair A: fully resolved, fully batched -> must disappear
            txnRow({
              id: 1,
              dinas_target: 'TA',
              status_konfirmasi: 'CONFIRMED',
              export_batch_id: 500,
            }),
            // Pair B: fully resolved but ONE row still unbatched -> must stay
            txnRow({
              id: 2,
              dinas_target: 'TB',
              status_konfirmasi: 'CONFIRMED',
              export_batch_id: 501,
            }),
            txnRow({
              id: 3,
              dinas_target: 'TB',
              status_konfirmasi: 'CONFIRMED',
              export_batch_id: null,
            }),
          ],
        };
      }
      if (sql.includes('rdt.export_subdocs')) {
        return { rows: [{ batch_id: 500, subdoc_number: 'SAP-A' }] };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);

    const pairs = await (
      service as unknown as {
        buildChainAwareProgress: (args: {
          initiatorDinas: string | null;
          groupBy: 'pair' | 'target';
        }) => Promise<{ dinas: string }[]>;
      }
    ).buildChainAwareProgress({ initiatorDinas: null, groupBy: 'target' });

    const dinasList = pairs.map((p) => p.dinas);
    expect(dinasList).not.toContain('TA'); // fully done -> gone
    expect(dinasList).toContain('TB'); // partially batched -> still shown
  });

  test('overdue: true when the majority declared period differs from the worst-case periode_efektif', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('t.export_batch_id,')) {
        return {
          rows: [
            txnRow({
              id: 1,
              declared_period: '2026-07',
              periode_efektif: '2026-08',
              status_konfirmasi: 'CONFIRMED',
            }),
          ],
        };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);
    const pairs = await (
      service as unknown as {
        buildChainAwareProgress: (args: {
          initiatorDinas: string | null;
          groupBy: 'pair' | 'target';
        }) => Promise<{ overdue?: boolean }[]>;
      }
    ).buildChainAwareProgress({ initiatorDinas: null, groupBy: 'target' });
    expect(pairs[0].overdue).toBe(true);
  });

  test("groupBy:'pair' appends the GLOBAL investigation pseudo-cards (unfiltered)", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('t.export_batch_id,')) return { rows: [] };
      if (sql.includes('SELECT id, dinas_inisiasi FROM rdt.transactions')) {
        return {
          rows: [
            { id: 900, dinas_inisiasi: 'TB' },
            { id: 901, dinas_inisiasi: 'TC' },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);
    const pairs = await (
      service as unknown as {
        buildChainAwareProgress: (args: {
          initiatorDinas: string | null;
          groupBy: 'pair' | 'target';
        }) => Promise<{ dinas: string; target_dinas?: string }[]>;
      }
    ).buildChainAwareProgress({ initiatorDinas: null, groupBy: 'pair' });

    const investigationCards = pairs.filter(
      (p) => p.target_dinas === 'INVESTIGATION',
    );
    expect(investigationCards.map((c) => c.dinas).sort()).toEqual(['TB', 'TC']);
  });
});

describe('DashboardService.getBreakdown', () => {
  test("filters out OTHER dinas' investigation pseudo-cards -- no leak (WAJIB per prompt)", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('t.export_batch_id,')) {
        return {
          rows: [
            txnRow({
              id: 1,
              dinas_inisiasi: 'TJ',
              dinas_target: 'TA',
              status_konfirmasi: 'PENDING',
            }),
          ],
        };
      }
      if (sql.includes('SELECT id, dinas_inisiasi FROM rdt.transactions')) {
        // investigation rows for BOTH TJ and TC -- TC's must not leak into TJ's breakdown
        return {
          rows: [
            { id: 900, dinas_inisiasi: 'TJ' },
            { id: 901, dinas_inisiasi: 'TC' },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);

    const pairs = await service.getBreakdown('TJ');

    expect(pairs.every((p) => String(p.dinas).toUpperCase() === 'TJ')).toBe(
      true,
    );
    expect(pairs.some((p) => p.target_dinas === 'INVESTIGATION')).toBe(true); // TJ's own card kept
    expect(
      pairs.filter((p) => p.target_dinas === 'INVESTIGATION'),
    ).toHaveLength(1); // TC's dropped
  });
});

describe('DashboardService.getKpis — waiting_to_repost (bug fix vs rdt/backend)', () => {
  test('outer WHERE includes RESOLVED statuses too, so the HAVING (0 blocking, >0 resolved) can actually match a ready pair', async () => {
    const { db, query } = fakeDb((sql) => {
      if (sql.includes('waiting_pairs')) return { rows: [{ c: 1 }] };
      return { rows: [{ c: 0 }] };
    });
    const service = new DashboardService(db);

    const kpis = await service.getKpis(tabUser);
    expect((kpis as { waiting_to_repost: number }).waiting_to_repost).toBe(1);

    const waitingCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('waiting_pairs'),
    ) as [string, unknown[]];
    const [outerWhereStatuses] = waitingCall[1];
    // The old rdt/backend query passed the SAME blocking-only list for both the outer WHERE and
    // the HAVING's blocking-count filter, which made "0 blocking rows in this group" impossible
    // (every row that survived the WHERE was already blocking) -- this asserts the fix: the outer
    // WHERE must admit RESOLVED rows too, or no pair could ever qualify.
    expect(outerWhereStatuses).toEqual(
      expect.arrayContaining(['CONFIRMED', 'BORNE_BY_INITIATOR']),
    );
  });
});

describe('DashboardService.getKpis — role-aware shape', () => {
  test('non-TAB: resolved_count = total - open_count', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('COUNT(DISTINCT dinas_target)')) {
        return {
          rows: [
            { total: 10, total_nilai: 5000, open_count: 3, pasangan_count: 2 },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);

    const kpis = await service.getKpis(teUser);
    expect(kpis).toEqual({
      is_global_view: false,
      total_transaksi: 10,
      total_nilai: 5000,
      pasangan_count: 2,
      open_count: 3,
      resolved_count: 7,
    });
  });

  test('TAB: 5-query global shape', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('COUNT(DISTINCT dinas_inisiasi)'))
        return { rows: [{ c: 12 }] };
      if (sql.includes('NEEDS_INVESTIGATION')) return { rows: [{ c: 3 }] };
      if (sql.includes('waiting_pairs')) return { rows: [{ c: 4 }] };
      if (sql.includes('subdoc_id IS NOT NULL')) return { rows: [{ c: 6 }] };
      if (sql.includes('dinas_target IS NOT NULL'))
        return { rows: [{ c: 500 }] };
      return { rows: [] };
    });
    const service = new DashboardService(db);

    const kpis = await service.getKpis(tabUser);
    expect(kpis).toEqual({
      is_global_view: true,
      dinas_aktif: 12,
      total_transaksi: 500,
      butuh_investigasi: 3,
      waiting_to_repost: 4,
      reposted: 6,
    });
  });
});

describe('DashboardService.getPerDinasRollup — status pill (4 cases)', () => {
  test('investigation wins regardless of open/reposted state', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('ORDER BY open DESC')) {
        return {
          rows: [{ dinas: 'TJ', total: 5, confirmed: 5, open: 0, declined: 0 }],
        };
      }
      if (sql.includes("NEEDS_INVESTIGATION' AND dinas_inisiasi")) {
        return { rows: [{ dinas: 'TJ', c: 2 }] };
      }
      return { rows: [{ c: 0 }] };
    });
    const service = new DashboardService(db);
    const [row] = await service.getPerDinasRollup();
    expect(row.status).toEqual({
      kind: 'investigation',
      label: 'Butuh Investigasi (2)',
    });
  });

  test('pending wins when open>0 and no investigation', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('ORDER BY open DESC')) {
        return {
          rows: [{ dinas: 'TJ', total: 5, confirmed: 2, open: 3, declined: 0 }],
        };
      }
      return { rows: [] };
    });
    const service = new DashboardService(db);
    const [row] = await service.getPerDinasRollup();
    expect(row.status).toEqual({
      kind: 'pending',
      label: 'Waiting for confirmation',
    });
  });

  test('reposted when total>0, open=0, no investigation, and zero unreposted RESOLVED rows', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('ORDER BY open DESC')) {
        return {
          rows: [{ dinas: 'TJ', total: 5, confirmed: 5, open: 0, declined: 0 }],
        };
      }
      if (sql.includes('subdoc_id IS NULL')) return { rows: [{ c: 0 }] };
      return { rows: [] };
    });
    const service = new DashboardService(db);
    const [row] = await service.getPerDinasRollup();
    expect(row.status).toEqual({ kind: 'reposted', label: 'Semua reposted' });
  });

  test('waiting-repost when total>0, open=0, no investigation, but some RESOLVED rows still unbatched', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('ORDER BY open DESC')) {
        return {
          rows: [{ dinas: 'TJ', total: 5, confirmed: 5, open: 0, declined: 0 }],
        };
      }
      if (sql.includes('subdoc_id IS NULL')) return { rows: [{ c: 3 }] };
      return { rows: [] };
    });
    const service = new DashboardService(db);
    const [row] = await service.getPerDinasRollup();
    expect(row.status).toEqual({
      kind: 'waiting-repost',
      label: 'Waiting to repost',
    });
  });
});

describe('DashboardService — needToConfirmTargetCodes (via getNeedToConfirmCount)', () => {
  test('TAB target codes include Corp but never TA', async () => {
    const { db, query } = fakeDb(() => ({ rows: [] }));
    const service = new DashboardService(db);

    await service.getNeedToConfirmCount(tabUser);

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    const targetCodes = params[0] as string[];
    expect(targetCodes).toEqual(['CORP', 'CORP']); // [myDinas='Corp', 'Corp'].map(upper)
    expect(targetCodes).not.toContain('TA');
  });

  test('non-TAB target codes are just their own dinas, uppercased', async () => {
    const { db, query } = fakeDb(() => ({ rows: [] }));
    const service = new DashboardService(db);

    await service.getNeedToConfirmCount(teUser);

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toEqual(['TE']);
  });
});
