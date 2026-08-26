import { DatabaseService } from '../../../core/database/database.service';
import type { DirectoryProvider } from '../../../core/directory/directory.interface';
import { DomainError } from '../../../core/errors/domain-error';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ExportConfirmService } from './export-confirm.service';

// Same fake-client/fake-db pattern as confirmation.service.spec.ts. An Error pushed onto the
// queue rejects that call instead of resolving it (used to simulate a mid-transaction DB failure).
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

function fakeCollaborators() {
  const record = jest
    .fn<Promise<string>, unknown[]>()
    .mockResolvedValue('LAINNYA');
  const rollbackAudit = { record } as unknown as RollbackAuditService;
  const directory = {
    'pic-tc-1': { dinas: 'TC', role: 'staff', display_name: 'PIC TC' },
    'pic-tc-2': { dinas: 'TC', role: 'staff', display_name: 'PIC TC 2' },
    'pic-tl-1': { dinas: 'TL', role: 'staff', display_name: 'PIC TL' },
    'tab-1': { dinas: 'Corp', role: 'TAB', display_name: 'TAB' },
  };
  const load = jest.fn().mockResolvedValue(directory);
  const directoryProvider = { load } as unknown as DirectoryProvider;
  return { rollbackAudit, record, directoryProvider, directory };
}

const baseArgs = {
  rawDinasInisiasi: 'TB',
  rawDinasTarget: 'TC',
  rawClosingDescription: null,
  rawSubdocNumber: 'SAP-123',
  rawTransactionIds: undefined,
  userId: 'user-tab-1',
  ip: '127.0.0.1',
};

describe('ExportConfirmService.confirm — happy path', () => {
  test('attaches every ATTACHABLE row, covers all of it with the first subdoc, top-level comment + notif to dinas_target', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] }, // gate: no BLOCKING left
      { rows: [{ id: '500' }] }, // INSERT export_batches (bigserial -> string from pg)
      { rows: [{ id: '1' }, { id: '2' }, { id: '3' }], rowCount: 3 }, // attach ATTACHABLE rows
      { rows: [{ id: '900' }] }, // INSERT export_subdocs
      { rows: [] }, // UPDATE subdoc_id
      { rows: [{ id: '5000' }] }, // INSERT comments
      { rows: [] }, // INSERT notifications (pic-tc-1)
      { rows: [] }, // INSERT notifications (pic-tc-2)
      { rows: [] }, // audit EXPORT_BATCH_CONFIRM
      { rows: [] }, // audit SUBDOC_ADDED
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const result = await service.confirm(baseArgs);

    expect(result.batch_id).toBe(500);
    expect(result.attached_count).toBe(3);
    expect(result.subdoc_number).toBe('SAP-123');
    expect(result.notified_user_ids.sort()).toEqual(['pic-tc-1', 'pic-tc-2']);

    // subdoc covers ALL attached ids (no transaction_ids given)
    const subdocUpdateCall = client.query.mock.calls[4];
    expect(String(subdocUpdateCall[0])).toContain('subdoc_id=$1');
    expect(subdocUpdateCall[1]).toEqual([900, [1, 2, 3]]);

    // comment is top-level NEW (parent_comment_id NULL), anchored to the LARGEST attached id
    const commentInsertCall = client.query.mock.calls[5];
    expect(commentInsertCall[1]).toEqual([
      3, // anchorId = max(1,2,3)
      'user-tab-1',
      'Repost TB → TC dikonfirmasi oleh TAB (subdoc SAP-123).', // fallback body
    ]);
    // args[1] (parent_comment_id) is the literal NULL in the SQL text, not a bind param -- assert
    // the query text itself encodes "parent_comment_id, ...) VALUES ($1, NULL, $2, $3)"
    expect(String(commentInsertCall[0])).toMatch(
      /VALUES \(\$1, NULL, \$2, \$3\)/,
    );
  });

  test('closing_description given: comment uses it verbatim, mention of a dinas OUTSIDE the pair is filtered out (privacy)', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }], rowCount: 1 },
      { rows: [{ id: 1 }] },
      { rows: [] },
      { rows: [{ id: 1 }] },
      { rows: [] }, // notif to pic-tc-1
      { rows: [] }, // notif to pic-tc-2
      { rows: [] },
      { rows: [] },
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    const result = await service.confirm({
      ...baseArgs,
      // @pic-tl-1 is dinas TL -- NOT part of this TB->TC pair -- must not leak into notified_user_ids
      rawClosingDescription: 'sudah diposting, cc @pic-tl-1',
    });

    expect(result.notified_user_ids).not.toContain('pic-tl-1');
    expect(result.notified_user_ids.sort()).toEqual(['pic-tc-1', 'pic-tc-2']);
    const commentInsertCall = client.query.mock.calls[5];
    expect(commentInsertCall[1][2]).toBe('sudah diposting, cc @pic-tl-1');
  });

  test('transaction_ids subset: only those ids get the first subdoc, the rest stay attached with subdoc_id NULL', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowCount: 3 }, // 3 attached
      { rows: [{ id: 900 }] },
      { rows: [] },
      { rows: [{ id: 1 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await service.confirm({ ...baseArgs, rawTransactionIds: [1, 2] });

    const subdocUpdateCall = client.query.mock.calls[4];
    expect(subdocUpdateCall[1]).toEqual([900, [1, 2]]); // only the requested subset
  });

  test('transaction_ids containing an id NOT in this attach batch -> 400, no subdoc/comment written', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }, // only 1,2 attached
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider, record } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.confirm({ ...baseArgs, rawTransactionIds: [1, 999] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SUBDOC_TRANSACTION_IDS',
    });
    expect(record).toHaveBeenCalledTimes(1);
    // no INSERT export_subdocs / comments query happened after the failed validation
    expect(client.query).toHaveBeenCalledTimes(3);
  });
});

describe('ExportConfirmService.confirm — gate & attach failures', () => {
  test('a pair with BLOCKING rows left -> 400 PAIR_NOT_READY, batch never inserted', async () => {
    const client = fakeClient([{ rows: [{ cnt: 4 }] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(service.confirm(baseArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'PAIR_NOT_READY',
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('nothing attachable -> 400 NO_ATTACHABLE_ROWS', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] },
      { rows: [{ id: 1 }] }, // INSERT batch succeeds
      { rows: [], rowCount: 0 }, // attach: nothing matched
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(service.confirm(baseArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'NO_ATTACHABLE_ROWS',
    });
  });
});

describe('ExportConfirmService.confirm — pre-transaction validation (atomicity)', () => {
  test('missing dinas_inisiasi -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.confirm({ ...baseArgs, rawDinasInisiasi: '' }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'FIELD_REQUIRED' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('subdoc_number blank-after-trim ("   ") -> 400, even though it is non-empty raw', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.confirm({ ...baseArgs, rawSubdocNumber: '   ' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'SUBDOC_NUMBER_REQUIRED',
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('closing_description over the length cap -> 400 TEXT_TOO_LONG, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { rollbackAudit, directoryProvider } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(
      service.confirm({
        ...baseArgs,
        rawClosingDescription: 'a'.repeat(2001),
      }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'TEXT_TOO_LONG' });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe('ExportConfirmService.confirm — atomicity + rollback audit 🔴', () => {
  test('a failure mid-transaction (e.g. DB error during comment insert) rolls back and records rollback-audit, preserving statusCode', async () => {
    const client = fakeClient([
      { rows: [{ cnt: 0 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }], rowCount: 1 },
      { rows: [{ id: 900 }] },
      { rows: [] },
      new Error('db exploded'), // comment insert blows up
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider, record } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    try {
      await service.confirm(baseArgs);
      throw new Error('expected confirm to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(500);
      expect((err as DomainError).errorCode).toBe('EXPORT_CONFIRM_FAILED');
      expect((err as DomainError).errorCategory).toBe('LAINNYA');
    }
    expect(record).toHaveBeenCalledTimes(1);
    const [args] = record.mock.calls[0] as [{ route: string; userId: string }];
    expect(args.route).toBe('repost/export/confirm');
    expect(args.userId).toBe('user-tab-1');
  });

  test('a business-rule DomainError (PAIR_NOT_READY) keeps its own statusCode/errorCode through rollback-audit', async () => {
    const client = fakeClient([{ rows: [{ cnt: 2 }] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit, directoryProvider, record } = fakeCollaborators();
    const service = new ExportConfirmService(
      db,
      rollbackAudit,
      directoryProvider,
    );

    await expect(service.confirm(baseArgs)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'PAIR_NOT_READY',
      errorCategory: 'LAINNYA',
    });
    expect(record).toHaveBeenCalledTimes(1);
  });
});
