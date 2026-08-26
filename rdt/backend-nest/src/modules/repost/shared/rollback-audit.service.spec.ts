import { DatabaseService } from '../../../core/database/database.service';
import { RollbackAuditService } from './rollback-audit.service';

describe('RollbackAuditService (koneksi terpisah dari client transaksi yang rollback)', () => {
  test('classifies the error, writes one ROLLBACK row via db.query (pool), and returns the category', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as DatabaseService;
    const service = new RollbackAuditService(db);

    const category = await service.record({
      userId: 'user-1',
      ip: '10.0.0.1',
      err: new Error('transaction not pending: 42'),
      route: 'repost/confirmation/:dinas/submit',
      transactionId: 42,
    });

    expect(category).toBe('DATA_TIDAK_VALID');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'ROLLBACK'");
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe(42);
    expect(params[5]).toBe('10.0.0.1');
    const detail = JSON.parse(params[4] as string) as {
      route: string;
      category: string;
      message: string;
    };
    expect(detail).toEqual({
      route: 'repost/confirmation/:dinas/submit',
      category: 'DATA_TIDAK_VALID',
      message: 'transaction not pending: 42',
    });
  });

  test('missing userId falls back to "unknown", transactionId defaults to null', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as DatabaseService;
    const service = new RollbackAuditService(db);

    await service.record({
      userId: '',
      ip: null,
      err: new Error('boom'),
      route: 'x',
    });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('unknown');
    expect(params[1]).toBeNull();
  });

  test('never throws even if the audit insert itself fails — category is still returned', async () => {
    const query = jest.fn().mockRejectedValue(new Error('DB down'));
    const db = { query } as unknown as DatabaseService;
    const service = new RollbackAuditService(db);

    await expect(
      service.record({
        userId: 'user-1',
        ip: null,
        err: new Error('whatever'),
        route: 'x',
      }),
    ).resolves.toEqual(expect.any(String));
  });
});
