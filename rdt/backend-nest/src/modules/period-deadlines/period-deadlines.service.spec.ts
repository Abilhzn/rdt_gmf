import { DatabaseService } from '../../core/database/database.service';
import { DomainError } from '../../core/errors/domain-error';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';
import { PeriodDeadlinesService } from './period-deadlines.service';

function fakeQueryQueue(queue: unknown[]) {
  return jest.fn(() => {
    const next = queue.shift();
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next ?? { rows: [] });
  });
}

function fakeDb(dbQueue: unknown[], clientQueue: unknown[] = []) {
  const query = fakeQueryQueue(dbQueue);
  const client = { query: fakeQueryQueue(clientQueue) };
  const withTransaction = jest.fn((fn: (c: unknown) => Promise<unknown>) =>
    fn(client),
  );
  const db = { query, withTransaction } as unknown as DatabaseService;
  return { db, query, client, withTransaction };
}

function fakeRollbackAudit() {
  const record = jest
    .fn<Promise<string>, unknown[]>()
    .mockResolvedValue('LAINNYA');
  return {
    rollbackAudit: { record } as unknown as RollbackAuditService,
    record,
  };
}

describe('PeriodDeadlinesService.getCurrentReminder', () => {
  test('uses currentAutoPeriode() and falls back to null when no default is set', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.getCurrentReminder();
    expect(result.deadline_at).toBeNull();
    expect(typeof result.periode).toBe('string');
    expect(query.mock.calls[0][1]).toEqual([result.periode]);
  });

  test('returns the deadline_at when a default exists', async () => {
    const { db } = fakeDb([
      { rows: [{ deadline_at: '2026-08-15T00:00:00Z' }] },
    ]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.getCurrentReminder();
    expect(result.deadline_at).toBe('2026-08-15T00:00:00Z');
  });
});

describe('PeriodDeadlinesService.listDeadlines', () => {
  test('no filters -> no WHERE clause', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await service.listDeadlines();
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  test('both filters -> WHERE on both, params in order', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await service.listDeadlines('TB', 'TC');
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('dinas_inisiasi = $1');
    expect(String(sql)).toContain('dinas_target = $2');
    expect(params).toEqual(['TB', 'TC']);
  });
});

describe('PeriodDeadlinesService.upsertDeadline', () => {
  const validArgs = {
    rawDinasInisiasi: 'tb',
    rawDinasTarget: 'tc',
    rawPeriode: '2026-07',
    rawDeadlineAt: '2026-08-01T00:00:00Z',
    userId: 'tab-1',
  };

  test('missing dinas_inisiasi/dinas_target -> 400 before any query', async () => {
    const { db, query } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(
      service.upsertDeadline({ ...validArgs, rawDinasInisiasi: '' }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'DINAS_REQUIRED' });
    expect(query).not.toHaveBeenCalled();
  });

  test('invalid periode/deadline -> 400 before dinas lookup', async () => {
    const { db, query } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(
      service.upsertDeadline({ ...validArgs, rawPeriode: 'bad' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_PERIOD_OR_DEADLINE',
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('an inactive/unknown dinas_inisiasi -> 400', async () => {
    const { db } = fakeDb([{ rows: [{ code: 'TC' }] }]); // only TC is active, not TB
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.upsertDeadline(validArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'UNKNOWN_DINAS_INISIASI',
    });
  });

  test('an inactive/unknown dinas_target -> 400', async () => {
    const { db } = fakeDb([{ rows: [{ code: 'TB' }] }]); // only TB is active, not TC
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.upsertDeadline(validArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'UNKNOWN_DINAS_TARGET',
    });
  });

  test('resolves case-insensitively to the actual stored-case dinas code, then upserts', async () => {
    const { db, query } = fakeDb([
      { rows: [{ code: 'TB' }, { code: 'Corp' }] },
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'Corp' }] },
    ]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.upsertDeadline({
      ...validArgs,
      rawDinasTarget: 'corp', // lowercase in, stored-case 'Corp' out
    });

    expect(result).toEqual({
      id: 1,
      dinas_inisiasi: 'TB',
      dinas_target: 'Corp',
    });
    const insertCall = query.mock.calls[1];
    expect(insertCall[1][0]).toBe('TB');
    expect(insertCall[1][1]).toBe('Corp');
    expect(String(insertCall[0])).toContain(
      'ON CONFLICT (dinas_inisiasi, dinas_target, periode)',
    );
  });
});

describe('PeriodDeadlinesService.upsertDefault — sweep, atomicity', () => {
  test('upserts the default AND sweeps matching pairs in the SAME transaction', async () => {
    const clientQueue = [
      { rows: [{ periode: '2026-07', deadline_at: '2026-08-01T00:00:00Z' }] },
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
    ];
    const { db, client } = fakeDb([], clientQueue);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.upsertDefault({
      rawPeriode: '2026-07',
      rawDeadlineAt: '2026-08-01T00:00:00Z',
      userId: 'tab-1',
      ip: null,
    });

    expect(result.deadline).toEqual({
      periode: '2026-07',
      deadline_at: '2026-08-01T00:00:00Z',
    });
    expect(result.swept).toEqual([
      { id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' },
    ]);
    const sweepCall = client.query.mock.calls[1];
    expect(String(sweepCall[0])).toContain('$2::timestamptz'); // explicit cast preserved
  });

  test('a failure during the sweep rolls back the default upsert too (atomic), rollback-audit recorded', async () => {
    const clientQueue = [
      { rows: [{ periode: '2026-07', deadline_at: '2026-08-01T00:00:00Z' }] },
      new Error('sweep exploded'),
    ];
    const { db } = fakeDb([], clientQueue);
    const { rollbackAudit, record } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(
      service.upsertDefault({
        rawPeriode: '2026-07',
        rawDeadlineAt: '2026-08-01T00:00:00Z',
        userId: 'tab-1',
        ip: '10.0.0.1',
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'PERIOD_DEADLINE_DEFAULT_FAILED',
    });
    expect(record).toHaveBeenCalledTimes(1);
  });

  test('invalid periode/deadline -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(
      service.upsertDefault({
        rawPeriode: 'bad',
        rawDeadlineAt: '2026-08-01T00:00:00Z',
        userId: 'tab-1',
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_PERIOD_OR_DEADLINE',
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe('PeriodDeadlinesService.deleteDefault', () => {
  test('a future deadline is deleted successfully', async () => {
    const future = new Date(Date.now() + 100000).toISOString();
    const { db, query } = fakeDb([
      { rows: [{ deadline_at: future }] },
      { rows: [] }, // DELETE
    ]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.deleteDefault('2026-12');
    expect(result).toEqual({ periode: '2026-12' });
    expect(String(query.mock.calls[1][0])).toContain(
      'DELETE FROM rdt.period_default_deadlines',
    );
  });

  test('a PAST deadline -> 400, DELETE never issued', async () => {
    const past = new Date(Date.now() - 100000).toISOString();
    const { db, query } = fakeDb([{ rows: [{ deadline_at: past }] }]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.deleteDefault('2026-01')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'DEADLINE_ALREADY_PASSED',
    });
    expect(query).toHaveBeenCalledTimes(1); // only the lookup, no DELETE
  });

  test('no row for that periode -> 404', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.deleteDefault('2026-01')).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'DEFAULT_DEADLINE_NOT_FOUND',
    });
  });

  test('a malformed periode -> 400 before any query', async () => {
    const { db, query } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.deleteDefault('2026-1')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_PERIODE',
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('PeriodDeadlinesService.getOverdue / getActivePairs', () => {
  test('getOverdue validates periode format', async () => {
    const { db, query } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.getOverdue('bad')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_PERIODE',
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('getOverdue maps rows through as-is', async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
            total: 3,
            periode_efektif: '2026-08',
          },
        ],
      },
    ]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.getOverdue('2026-07');
    expect(result).toEqual({
      periode: '2026-07',
      overdue: [
        {
          dinas_inisiasi: 'TB',
          dinas_target: 'TC',
          total: 3,
          periode_efektif: '2026-08',
        },
      ],
    });
  });

  test('getActivePairs validates periode format', async () => {
    const { db, query } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    await expect(service.getActivePairs(undefined)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_PERIODE',
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('getActivePairs returns the rows under `active`', async () => {
    const { db } = fakeDb([
      {
        rows: [
          { dinas_inisiasi: 'TB', dinas_target: 'TC', total: 5, open_count: 2 },
        ],
      },
    ]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);

    const result = await service.getActivePairs('2026-07');
    expect(result.active).toEqual([
      { dinas_inisiasi: 'TB', dinas_target: 'TC', total: 5, open_count: 2 },
    ]);
  });
});

describe('DomainError sanity', () => {
  test('a validation failure is thrown as an actual DomainError', async () => {
    const { db } = fakeDb([]);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new PeriodDeadlinesService(db, rollbackAudit);
    await expect(service.getOverdue('bad')).rejects.toBeInstanceOf(DomainError);
  });
});
