import type { Identity } from '../../../core/security/identity.interface';
import {
  canAccessPair,
  getPairCommentThread,
  getPairTransactions,
} from './dashboard-detail-helpers';

function fakeDb(
  handler: (sql: string, params?: unknown[]) => { rows: unknown[] },
) {
  const query = jest.fn((sql: string, params?: unknown[]) =>
    Promise.resolve(handler(sql, params)),
  );
  return { query } as unknown as Parameters<typeof getPairTransactions>[0];
}

describe('canAccessPair', () => {
  const initiator = 'TJ';
  const target = 'TC';

  test('TAB can access any pair', () => {
    const tab: Identity = { userId: 'u', dinas: 'Corp', role: 'TAB' };
    expect(canAccessPair(tab, initiator, target)).toBe(true);
  });

  test('PIC of the initiator dinas can access', () => {
    const pic: Identity = { userId: 'u', dinas: 'tj', role: 'staff' };
    expect(canAccessPair(pic, initiator, target)).toBe(true);
  });

  test('PIC of the target dinas can access', () => {
    const pic: Identity = { userId: 'u', dinas: 'TC', role: 'staff' };
    expect(canAccessPair(pic, initiator, target)).toBe(true);
  });

  test('PIC of an unrelated dinas is refused', () => {
    const pic: Identity = { userId: 'u', dinas: 'TB', role: 'staff' };
    expect(canAccessPair(pic, initiator, target)).toBe(false);
  });
});

describe('getPairTransactions', () => {
  test('INVESTIGATION sentinel (case-insensitive) -> plain status filter, no chain attached', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("status_konfirmasi='NEEDS_INVESTIGATION'")) {
        return { rows: [{ id: 1, dinas_target: null, reassign_count: 0 }] };
      }
      return { rows: [] };
    });

    const rows = await getPairTransactions(db, 'TJ', 'investigation');
    expect(rows).toEqual([{ id: 1, dinas_target: null, reassign_count: 0 }]);
    expect(rows[0].chain).toBeUndefined();
  });

  test('a transaction whose CURRENT target differs from the queried target, but whose reassign chain passed through it, is still included', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('dinas_target IS NOT NULL')) {
        return {
          rows: [
            { id: 10, dinas_target: 'TE', reassign_count: 2 }, // now at TE
            { id: 11, dinas_target: 'TF', reassign_count: 0 }, // never redirected, unrelated
          ],
        };
      }
      if (sql.includes('rdt.audit_log')) {
        return {
          rows: [
            { transaction_id: 10, detail: { from_dinas: 'TR' } },
            { transaction_id: 10, detail: { from_dinas: 'TS' } },
          ],
        };
      }
      return { rows: [] };
    });

    const rows = await getPairTransactions(db, 'TJ', 'tr'); // lowercase, must still match TR
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(10);
    expect(rows[0].chain).toEqual(['TJ', 'TR', 'TS', 'TE']);
  });

  test('a transaction never touching the queried target at all is excluded', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('dinas_target IS NOT NULL')) {
        return { rows: [{ id: 20, dinas_target: 'TF', reassign_count: 0 }] };
      }
      return { rows: [] };
    });

    const rows = await getPairTransactions(db, 'TJ', 'TR');
    expect(rows).toHaveLength(0);
  });
});

describe('getPairCommentThread', () => {
  test('merges comments across every transaction id given, chronological order, resolves author_display_name', async () => {
    const db = fakeDb(() => ({
      rows: [
        {
          id: 1,
          transaction_id: 100,
          parent_comment_id: null,
          author_user_id: 'demo-pic-tj',
          body: 'halo',
          created_at: '2026-08-01T00:00:00Z',
        },
        {
          id: 2,
          transaction_id: 101,
          parent_comment_id: 1,
          author_user_id: 'unknown-user',
          body: 'reply',
          created_at: '2026-08-02T00:00:00Z',
        },
      ],
    }));
    const directory = {
      'demo-pic-tj': { dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ' },
    };

    const comments = await getPairCommentThread(db, [100, 101], directory);
    expect(comments).toEqual([
      {
        id: 1,
        parent_comment_id: null,
        author_user_id: 'demo-pic-tj',
        author_display_name: 'PIC TJ',
        body: 'halo',
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 2,
        parent_comment_id: 1,
        author_user_id: 'unknown-user',
        author_display_name: 'unknown-user', // fallback, not in directory
        body: 'reply',
        created_at: '2026-08-02T00:00:00Z',
      },
    ]);
  });

  test('empty transaction id list short-circuits to [] without querying', async () => {
    const query = jest.fn();
    const db = { query } as unknown as Parameters<
      typeof getPairTransactions
    >[0];
    const comments = await getPairCommentThread(db, [], {});
    expect(comments).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
