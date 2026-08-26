import { DatabaseService } from '../../core/database/database.service';
import type { DirectoryProvider } from '../../core/directory/directory.interface';
import { DomainError } from '../../core/errors/domain-error';
import type { Identity } from '../../core/security/identity.interface';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';
import { DashboardDetailService } from './dashboard-detail.service';

// `next instanceof Error` rejects that call (simulate a mid-transaction DB failure); otherwise
// resolves it. Used for both the plain `db.query` queue (read-only calls) and the transactional
// `client.query` queue (postComment) -- getDetail/getComments never open a transaction, so they
// only ever consume the `db` queue; postComment only ever consumes the `client` queue.
function fakeQueryQueue(queue: unknown[]) {
  return jest.fn(() => {
    const next = queue.shift();
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next ?? { rows: [] });
  });
}

function fakeDb(dbQueue: unknown[], clientQueue: unknown[]) {
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
  const directory = {
    'demo-pic-tj': { dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ' },
    'demo-pic-tc': { dinas: 'TC', role: 'PIC', display_name: 'PIC TC' },
    'demo-pic-tl': { dinas: 'TL', role: 'PIC', display_name: 'PIC TL' },
  };
  const load = jest.fn().mockResolvedValue(directory);
  const directoryProvider = { load } as unknown as DirectoryProvider;
  return { rollbackAudit, record, directoryProvider, directory };
}

const tabUser: Identity = { userId: 'tab-1', dinas: 'Corp', role: 'TAB' };
const outsiderUser: Identity = { userId: 'u-tb', dinas: 'TB', role: 'staff' };

describe('DashboardDetailService — access control', () => {
  test('a PIC outside the pair gets 403 on getDetail/getComments/postComment', async () => {
    const { db } = fakeDb([], []);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.getDetail(outsiderUser, 'TJ', 'TC'),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'FORBIDDEN_PAIR_ACCESS',
    });
    await expect(
      service.getComments(outsiderUser, 'TJ', 'TC'),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.postComment({
        user: outsiderUser,
        initiatorDinas: 'TJ',
        targetDinas: 'TC',
        rawBody: 'hi',
        rawParentCommentId: undefined,
        ip: null,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('DashboardDetailService.getDetail', () => {
  test('progress is computed directly from getPairTransactions, not a 5b card lookup', async () => {
    const dbQueue = [
      // main actionable txn query (getPairTransactions) -- no reassigned ids, so the
      // audit_log chain query is never issued (guarded on empty id array).
      {
        rows: [
          {
            id: 1,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'CONFIRMED',
            ref_doc: 'R1',
            remark: null,
            dinas_target: 'TC',
            reassign_count: 0,
          },
          {
            id: 2,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'PENDING',
            ref_doc: 'R2',
            remark: null,
            dinas_target: 'TC',
            reassign_count: 0,
          },
        ],
      },
      { rows: [] }, // comment thread
    ];
    const { db } = fakeDb(dbQueue, []);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const detail = await service.getDetail(tabUser, 'TJ', 'TC');

    expect(detail.progress).toEqual({
      dinas: 'TC',
      total: 2,
      resolved: 1,
      open: 1,
      declined_pending_action: 0,
      percent: 50,
      chain: undefined, // chain is ['TJ','TC'], length 2 -- not >2, so hidden
    });
    expect(detail.transactions).toHaveLength(2);
  });

  test('chain is exposed only when every transaction agrees AND length>2 (reassigned pair)', async () => {
    const dbQueue = [
      {
        rows: [
          {
            id: 10,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'CONFIRMED',
            ref_doc: 'R1',
            remark: null,
            dinas_target: 'TE',
            reassign_count: 1,
          },
        ],
      },
      { rows: [{ transaction_id: 10, detail: { from_dinas: 'TR' } }] }, // audit_log chain
      { rows: [] }, // comment thread
    ];
    const { db } = fakeDb(dbQueue, []);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const detail = await service.getDetail(tabUser, 'TJ', 'TR');
    expect(detail.progress.chain).toEqual(['TJ', 'TR', 'TE']);
  });
});

describe('DashboardDetailService.postComment', () => {
  const baseArgs = {
    user: tabUser,
    initiatorDinas: 'TJ',
    targetDinas: 'TC',
    rawBody: 'sudah dicek',
    rawParentCommentId: undefined as unknown,
    ip: '127.0.0.1',
  };

  test('without parent_comment_id: anchors to the LARGEST transaction id in the pair, top-level (parent NULL)', async () => {
    const clientQueue = [
      // getPairTransactions inside the transaction
      {
        rows: [
          {
            id: 5,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'CONFIRMED',
            ref_doc: null,
            remark: null,
            dinas_target: 'TC',
            reassign_count: 0,
          },
          {
            id: 9,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'PENDING',
            ref_doc: null,
            remark: null,
            dinas_target: 'TC',
            reassign_count: 0,
          },
        ],
      },
      { rows: [{ id: 500, created_at: '2026-08-01T00:00:00Z' }] }, // INSERT comments
    ];
    const { db, client } = fakeDb([], clientQueue);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const result = await service.postComment(baseArgs);

    expect(result.comment.transaction_id).toBe(9); // the LARGEST id
    expect(result.comment.parent_comment_id).toBeNull();
    const insertCall = client.query.mock.calls[1];
    expect(insertCall[1]).toEqual([9, null, 'tab-1', 'sudah dicek']);
  });

  test('with a valid parent_comment_id: transaction_id is INHERITED from the parent, not recomputed', async () => {
    const clientQueue = [
      { rows: [{ transaction_id: 777 }] }, // parent lookup
      { rows: [{ id: 501, created_at: '2026-08-01T00:00:00Z' }] }, // INSERT comments
    ];
    const { db, client } = fakeDb([], clientQueue);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const result = await service.postComment({
      ...baseArgs,
      rawParentCommentId: 42,
    });

    expect(result.comment.transaction_id).toBe(777);
    expect(result.comment.parent_comment_id).toBe(42);
    const insertCall = client.query.mock.calls[1];
    expect(insertCall[1]).toEqual([777, 42, 'tab-1', 'sudah dicek']);
  });

  test('a parent_comment_id that does not exist -> 400, nothing written', async () => {
    const { db, client } = fakeDb([], [{ rows: [] }]);
    const { rollbackAudit, directoryProvider, record } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.postComment({ ...baseArgs, rawParentCommentId: 999 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'PARENT_COMMENT_NOT_FOUND',
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1); // only the failed parent lookup
  });

  test('a pair with zero transactions and no parent_comment_id -> 400 (nothing to anchor to)', async () => {
    const { db } = fakeDb([], [{ rows: [] }]); // getPairTransactions -> empty
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(service.postComment(baseArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'NO_TRANSACTIONS_FOR_PAIR',
    });
  });

  test('mentioning a dinas OUTSIDE the pair is not notified (privacy)', async () => {
    const clientQueue = [
      {
        rows: [
          {
            id: 5,
            account: 'A',
            nominal: 10,
            status_konfirmasi: 'CONFIRMED',
            ref_doc: null,
            remark: null,
            dinas_target: 'TC',
            reassign_count: 0,
          },
        ],
      },
      { rows: [{ id: 500, created_at: 'now' }] },
      { rows: [] }, // INSERT notifications for demo-pic-tc (in-pair)
    ];
    const { db } = fakeDb([], clientQueue);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const result = await service.postComment({
      ...baseArgs,
      rawBody: 'cc @demo-pic-tc dan @demo-pic-tl',
    });

    expect(result.notified).toEqual(['demo-pic-tc']);
    expect(result.notified).not.toContain('demo-pic-tl');
  });

  test('empty body -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb([], []);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.postComment({ ...baseArgs, rawBody: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'REQUIRED' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('a mid-transaction failure rolls back and records rollback-audit', async () => {
    const clientQueue = [
      { rows: [{ transaction_id: 1 }] },
      new Error('db exploded'),
    ];
    const { db } = fakeDb([], clientQueue);
    const { rollbackAudit, directoryProvider, record } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.postComment({ ...baseArgs, rawParentCommentId: 1 }),
    ).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'DASHBOARD_COMMENT_FAILED',
    });
    expect(record).toHaveBeenCalledTimes(1);
    const [args] = record.mock.calls[0] as [{ route: string }];
    expect(args.route).toBe(
      'dashboard/detail/:initiatorDinas/:targetDinas/comments',
    );
  });
});

describe('DomainError sanity', () => {
  test('access-denied is thrown as an actual DomainError', async () => {
    const { db } = fakeDb([], []);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new DashboardDetailService(
      db,
      rollbackAudit,
      directoryProvider,
    );
    await expect(
      service.getComments(outsiderUser, 'TJ', 'TC'),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
