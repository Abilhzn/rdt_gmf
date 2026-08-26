import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ExportSubdocService } from './export-subdoc.service';

function fakeClient(queue: unknown[]) {
  return {
    query: jest.fn(() => {
      const next = queue.shift();
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    }),
  };
}

function fakeDb(client: ReturnType<typeof fakeClient>) {
  const withTransaction = jest.fn((fn: (c: unknown) => Promise<unknown>) =>
    fn(client),
  );
  const db = { withTransaction } as unknown as DatabaseService;
  return { db, withTransaction };
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

const batchRow = { id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' };

describe('ExportSubdocService.addSubdoc — overflow default (no transaction_ids)', () => {
  test('defaults to every UNASSIGNED row in the batch, not every row in the batch', async () => {
    const client = fakeClient([
      { rows: [batchRow] }, // SELECT batch
      { rows: [{ id: 4 }, { id: 5 }] }, // unassigned (2 already covered by subdoc 1, out of scope)
      {
        rows: [
          {
            id: 900,
            subdoc_number: 'SAP-2',
            created_at: '2026-08-26T00:00:00Z',
          },
        ],
      }, // INSERT subdoc
      { rows: [] }, // UPDATE subdoc_id
      { rows: [] }, // audit
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    const result = await service.addSubdoc({
      batchId: 1,
      rawSubdocNumber: 'SAP-2',
      rawTransactionIds: undefined,
      userId: 'tab-1',
      ip: null,
    });

    expect(result).toEqual({
      id: 900,
      subdoc_number: 'SAP-2',
      created_at: '2026-08-26T00:00:00Z',
      transaction_ids: [4, 5],
    });
    const updateCall = client.query.mock.calls[3];
    expect(updateCall[1]).toEqual([900, [4, 5]]);
  });
});

describe('ExportSubdocService.addSubdoc — custom transaction_ids', () => {
  test('a subset of unassigned ids is honored, covers only that subset', async () => {
    const client = fakeClient([
      { rows: [batchRow] },
      { rows: [{ id: 4 }, { id: 5 }, { id: 6 }] },
      { rows: [{ id: 900, subdoc_number: 'SAP-2', created_at: 'now' }] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    const result = await service.addSubdoc({
      batchId: 1,
      rawSubdocNumber: 'SAP-2',
      rawTransactionIds: [4, 5],
      userId: 'tab-1',
      ip: null,
    });

    expect(result.transaction_ids).toEqual([4, 5]);
  });

  test('an id already covered by another subdoc (not in unassigned) -> 400, nothing written', async () => {
    const client = fakeClient([
      { rows: [batchRow] },
      { rows: [{ id: 4 }, { id: 5 }] }, // id 6 already has a subdoc -> not in this set
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, record } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    await expect(
      service.addSubdoc({
        batchId: 1,
        rawSubdocNumber: 'SAP-2',
        rawTransactionIds: [4, 6],
        userId: 'tab-1',
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SUBDOC_TRANSACTION_IDS',
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2); // no INSERT export_subdocs reached
  });
});

describe('ExportSubdocService.addSubdoc — edge cases', () => {
  test('batch not found -> 404', async () => {
    const client = fakeClient([{ rows: [] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    await expect(
      service.addSubdoc({
        batchId: 999,
        rawSubdocNumber: 'SAP-2',
        rawTransactionIds: undefined,
        userId: 'tab-1',
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'EXPORT_BATCH_NOT_FOUND',
    });
  });

  test('batch already 100% covered (no unassigned rows) -> 400 NO_UNASSIGNED_TRANSACTIONS', async () => {
    const client = fakeClient([{ rows: [batchRow] }, { rows: [] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    await expect(
      service.addSubdoc({
        batchId: 1,
        rawSubdocNumber: 'SAP-2',
        rawTransactionIds: undefined,
        userId: 'tab-1',
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'NO_UNASSIGNED_TRANSACTIONS',
    });
  });

  test('blank-after-trim subdoc_number -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    await expect(
      service.addSubdoc({
        batchId: 1,
        rawSubdocNumber: '   ',
        rawTransactionIds: undefined,
        userId: 'tab-1',
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'SUBDOC_NUMBER_REQUIRED',
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('a mid-transaction DB failure rolls back and preserves the DomainError through rollback-audit', async () => {
    const client = fakeClient([
      { rows: [batchRow] },
      { rows: [{ id: 4 }] },
      new Error('db exploded'),
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, record } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);

    await expect(
      service.addSubdoc({
        batchId: 1,
        rawSubdocNumber: 'SAP-2',
        rawTransactionIds: undefined,
        userId: 'tab-1',
        ip: '10.0.0.1',
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'EXPORT_SUBDOC_FAILED',
    });
    expect(record).toHaveBeenCalledTimes(1);
    const [args] = record.mock.calls[0] as [{ route: string }];
    expect(args.route).toBe('repost/export/:batchId/subdocs');
  });
});

describe('DomainError sanity', () => {
  test('batch-not-found is thrown as an actual DomainError', async () => {
    const client = fakeClient([{ rows: [] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ExportSubdocService(db, rollbackAudit);
    await expect(
      service.addSubdoc({
        batchId: 1,
        rawSubdocNumber: 'x',
        rawTransactionIds: undefined,
        userId: 'u',
        ip: null,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
