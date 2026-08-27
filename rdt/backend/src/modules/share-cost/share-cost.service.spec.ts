import { DatabaseService } from '../../core/database/database.service';
import { DomainError } from '../../core/errors/domain-error';
import { PairCommentService } from '../repost/shared/pair-comment.service';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';
import { ShareCostService } from './share-cost.service';

function fakeQueryQueue(queue: unknown[]) {
  return jest.fn(() => {
    const next = queue.shift();
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next ?? { rows: [] });
  });
}

function fakeDb(dbQueue: unknown[] = [], clientQueue: unknown[] = []) {
  const query = fakeQueryQueue(dbQueue);
  const client = { query: fakeQueryQueue(clientQueue) };
  const withTransaction = jest.fn((fn: (c: unknown) => Promise<unknown>) =>
    fn(client),
  );
  const db = { query, withTransaction } as unknown as DatabaseService;
  return { db, query, client, withTransaction };
}

function fakeCollaborators() {
  const record = jest
    .fn<Promise<string>, unknown[]>()
    .mockResolvedValue('LAINNYA');
  const rollbackAudit = { record } as unknown as RollbackAuditService;
  const post = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
  const pairComment = { post } as unknown as PairCommentService;
  return { rollbackAudit, record, pairComment, post };
}

const baseArgs = {
  transactionId: 100,
  rawSplits: [
    { dinas_target: 'th', nominal: 35 },
    { dinas_target: 'tu', nominal: 65 },
  ],
  rawNote: 'alasan split',
  userId: 'tab-1',
  ip: '127.0.0.1',
};

describe('ShareCostService.getCandidates', () => {
  test('no q -> plain PENDING/TAB filter, no ILIKE clause', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await service.getCandidates(undefined);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("t.dinas_target = 'TAB'");
    expect(String(sql)).not.toContain('ILIKE');
    expect(params).toEqual([]);
  });

  test('q trims and applies to account/ref_doc/remark with the SAME param', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await service.getCandidates('  4900123  ');
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('t.account ILIKE $1');
    expect(String(sql)).toContain('t.ref_doc ILIKE $1');
    expect(String(sql)).toContain('t.remark ILIKE $1');
    expect(params).toEqual(['%4900123%']);
  });
});

describe('ShareCostService.splitTransaction — pre-transaction validation', () => {
  test('empty note -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({ ...baseArgs, rawNote: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'REQUIRED' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('splits with fewer than 2 rows -> 400', async () => {
    const { db, withTransaction } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [{ dinas_target: 'TH', nominal: 100 }],
      }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'SPLITS_MIN_TWO' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('splits not an array -> 400', async () => {
    const { db } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({ ...baseArgs, rawSplits: 'nope' }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'SPLITS_MIN_TWO' });
  });

  test('a split row missing dinas_target -> 400', async () => {
    const { db } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [{ nominal: 50 }, { dinas_target: 'TH', nominal: 50 }],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SPLIT_ROW',
    });
  });

  test('a split row with a non-number nominal (numeric string) -> 400', async () => {
    const { db } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [
          { dinas_target: 'TH', nominal: '50' },
          { dinas_target: 'TU', nominal: 50 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SPLIT_ROW',
    });
  });

  test('a split row with nominal === 0 -> 400 (zero not allowed, negative would be)', async () => {
    const { db } = fakeDb();
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [
          { dinas_target: 'TH', nominal: 0 },
          { dinas_target: 'TU', nominal: 100 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SPLIT_ROW',
    });
  });
});

describe('ShareCostService.splitTransaction — transactional path', () => {
  const originalRow = {
    id: 100,
    status_konfirmasi: 'PENDING',
    dinas_inisiasi: 'TJ',
    dinas_target: 'TAB',
    nominal: '100.00',
  };
  const activeDinasRows = {
    rows: [{ code: 'TH' }, { code: 'TU' }, { code: 'Corp' }],
  };

  test('happy path: SPLIT_VOID + copy-forward inserts + audit + PairCommentService reused', async () => {
    const clientQueue = [
      { rows: [originalRow] }, // lock original
      activeDinasRows, // active dinas
      { rows: [] }, // UPDATE SPLIT_VOID
      { rows: [{ id: 201 }] }, // INSERT split 1
      { rows: [{ id: 202 }] }, // INSERT split 2
      { rows: [] }, // audit_log
    ];
    const { db, client } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit, post } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    const result = await service.splitTransaction(baseArgs);

    expect(result).toEqual({ split_from: 100, split_into: [201, 202] });
    const voidCall = client.query.mock.calls[2];
    expect(String(voidCall[0])).toContain("SET status_konfirmasi='SPLIT_VOID'");
    expect(voidCall[1]).toEqual([100]);

    const insert1 = client.query.mock.calls[3];
    expect(String(insert1[0])).toContain('split_from_transaction_id');
    expect(insert1[1]).toEqual([100, 'TH', 35]); // resolved to stored-case 'TH'

    const auditCall = client.query.mock.calls[5];
    expect(auditCall[1]).toEqual([
      'tab-1',
      100,
      'SPLIT_BY_TAB',
      'PENDING',
      'SPLIT_VOID',
      JSON.stringify({
        split_into: [201, 202],
        note: 'alasan split',
        splits: [
          { dinas_target: 'TH', nominal: 35 },
          { dinas_target: 'TU', nominal: 65 },
        ],
      }),
      '127.0.0.1',
    ]);

    // Comment posted on the ORIGINAL pair (TJ -> TAB), reusing PairCommentService verbatim.
    expect(post).toHaveBeenCalledWith(client, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TAB',
      implicitRecipientDinas: 'TAB',
      fallbackTransactionId: 100,
      authorUserId: 'tab-1',
      body: '[Share-Cost split oleh TAB] Baris ini dibelah jadi: TH 35, TU 65. alasan split',
    });
  });

  test('resolves dinas_target case-insensitively to the actual stored-case code (e.g. Corp)', async () => {
    const clientQueue = [
      { rows: [originalRow] },
      activeDinasRows,
      { rows: [] },
      { rows: [{ id: 201 }] },
      { rows: [{ id: 202 }] },
      { rows: [] },
    ];
    const { db, client } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await service.splitTransaction({
      ...baseArgs,
      rawSplits: [
        { dinas_target: 'corp', nominal: 40 },
        { dinas_target: 'tu', nominal: 60 },
      ],
    });

    const insert1 = client.query.mock.calls[3];
    expect(insert1[1]).toEqual([100, 'Corp', 40]); // stored-case, not 'CORP'
  });

  test('an unknown/inactive dinas_target -> 400, nothing written after the lookup', async () => {
    const clientQueue = [{ rows: [originalRow] }, activeDinasRows];
    const { db, client } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit, record } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [
          { dinas_target: 'ZZZ', nominal: 35 },
          { dinas_target: 'TU', nominal: 65 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SPLIT_DINAS_TARGET',
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2); // lock + dinas lookup only
  });

  test('SUM mismatch by even 1 cent -> 400, atomic (nothing written after the check)', async () => {
    const clientQueue = [{ rows: [originalRow] }, activeDinasRows];
    const { db, client } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(
      service.splitTransaction({
        ...baseArgs,
        rawSplits: [
          { dinas_target: 'TH', nominal: 35.01 },
          { dinas_target: 'TU', nominal: 65 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'SPLIT_SUM_MISMATCH',
    });
    expect(client.query).toHaveBeenCalledTimes(2); // lock + dinas lookup, no UPDATE/INSERT
  });

  test('a row that is not PENDING (e.g. CONFIRMED) -> 409, cannot be split', async () => {
    const clientQueue = [
      { rows: [{ ...originalRow, status_konfirmasi: 'CONFIRMED' }] },
    ];
    const { db } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(service.splitTransaction(baseArgs)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'NOT_PENDING',
    });
  });

  test('transaction not found -> 404', async () => {
    const { db } = fakeDb([], [{ rows: [] }]);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(service.splitTransaction(baseArgs)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'TRANSACTION_NOT_FOUND',
    });
  });

  test('a mid-transaction DB failure rolls back and records rollback-audit with the transactionId', async () => {
    const clientQueue = [
      { rows: [originalRow] },
      activeDinasRows,
      { rows: [] },
      new Error('db exploded'),
    ];
    const { db } = fakeDb([], clientQueue);
    const { pairComment, rollbackAudit, record } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);

    await expect(service.splitTransaction(baseArgs)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'SHARE_COST_SPLIT_FAILED',
    });
    expect(record).toHaveBeenCalledTimes(1);
    const [args] = record.mock.calls[0] as [
      { route: string; transactionId: number },
    ];
    expect(args.route).toBe('share-cost/:transactionId/split');
    expect(args.transactionId).toBe(100);
  });
});

describe('DomainError sanity', () => {
  test('not-found is thrown as an actual DomainError', async () => {
    const { db } = fakeDb([], [{ rows: [] }]);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ShareCostService(db, pairComment, rollbackAudit);
    await expect(service.splitTransaction(baseArgs)).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
