import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { RowStatus } from '../../../core/enums/row-status.enum';
import type { Identity } from '../../../core/security/identity.interface';
import type { StorageService } from '../../../core/storage/storage.service';
import { PairCommentService } from '../shared/pair-comment.service';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { CHUNK_SIZE, PersistRowInput, PersistService } from './persist.service';

// Same fake-client/fake-db pattern as confirmation.service.spec.ts: each test pre-loads a queue
// of query results consumed in call order.
function fakeClient(queue: unknown[]) {
  return { query: jest.fn(() => Promise.resolve(queue.shift())) };
}

function fakeDb(client: ReturnType<typeof fakeClient>) {
  const query = jest.fn<Promise<unknown>, [string, unknown[]?]>();
  const withTransaction = jest.fn((fn: (c: unknown) => Promise<unknown>) =>
    fn(client),
  );
  const db = { query, withTransaction } as unknown as DatabaseService;
  return { db, query, withTransaction };
}

function fakeCollaborators() {
  const post = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
  const record = jest
    .fn<Promise<string>, unknown[]>()
    .mockResolvedValue('LAINNYA');
  const putObject = jest
    .fn<Promise<void>, unknown[]>()
    .mockResolvedValue(undefined);
  const getObject = jest
    .fn<Promise<Buffer>, unknown[]>()
    .mockResolvedValue(Buffer.from('workbook-bytes'));
  const objectExists = jest
    .fn<Promise<boolean>, unknown[]>()
    .mockResolvedValue(true);
  const pairComment = { post } as unknown as PairCommentService;
  const rollbackAudit = { record } as unknown as RollbackAuditService;
  const storage = {
    putObject,
    getObject,
    objectExists,
  } as unknown as StorageService;
  return {
    pairComment,
    rollbackAudit,
    post,
    record,
    storage,
    putObject,
    getObject,
    objectExists,
  };
}

const uploader: Identity = { userId: 'user-1', dinas: 'TB', role: 'staff' };

function pendingRow(overrides: Partial<PersistRowInput> = {}): PersistRowInput {
  return {
    status_konfirmasi: RowStatus.PENDING,
    dinas_inisiasi: 'TB',
    dinas_target: 'TC',
    nominal: 500,
    account: 'ACC-1',
    ...overrides,
  };
}

describe('PersistService.persist — happy path', () => {
  test('fresh upload (no prior, no file, no description): inserts rows, returns response shape', async () => {
    const client = fakeClient([
      { rows: [] }, // 1. lock prior ACTIVE upload for dinas+period -> none
      { rows: [{ id: 100 }] }, // 2. INSERT uploads
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] }, // insert chunk
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.persist({
      rawRows: JSON.stringify([pendingRow()]),
      originalFilename: 'DT TB - Jun 2026.xlsx',
      rawDescription: null,
      user: uploader,
      ip: '127.0.0.1',
    });

    expect(result).toEqual({
      inserted: 1,
      upload_id: 100,
      duplicates_flagged: 0,
      superseded_upload_ids: [],
      superseded_transaction_count: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('rows given as an already-parsed array (non-multipart caller) works the same', async () => {
    const client = fakeClient([
      { rows: [] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.persist({
      rawRows: [pendingRow()],
      originalFilename: 'f.xlsx',
      rawDescription: undefined,
      user: uploader,
      ip: null,
    });
    expect(result.inserted).toBe(1);
  });

  test('attached file is saved via StorageService (not fs) under uploads/<id>-<sanitized>', async () => {
    const client = fakeClient([
      { rows: [] },
      { rows: [{ id: 101 }] },
      { rows: [] }, // UPDATE uploads.original_file_path
      { rows: [{ id: 2, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage, putObject } =
      fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const buffer = Buffer.from('xlsx-bytes');
    await service.persist({
      rawRows: JSON.stringify([pendingRow()]),
      originalFilename: '06. DT TB - Jun 2026.xlsx',
      rawDescription: null,
      user: uploader,
      ip: null,
      file: {
        buffer,
        originalname: '06. DT TB - Jun 2026.xlsx',
        mimetype: 'application/vnd.ms-excel',
      },
    });

    expect(putObject).toHaveBeenCalledWith(
      'uploads/101-06._DT_TB_-_Jun_2026.xlsx',
      buffer,
      'application/vnd.ms-excel',
    );
    const updateCall = client.query.mock.calls[2];
    expect(String(updateCall[0])).toContain('original_file_path');
    expect(updateCall[1]).toEqual([
      'uploads/101-06._DT_TB_-_Jun_2026.xlsx',
      101,
    ]);
  });
});

describe('PersistService.persist — supersede', () => {
  test('prior upload with NO ledger entries is superseded, new upload proceeds', async () => {
    const client = fakeClient([
      { rows: [{ id: 50 }] }, // lock prior ACTIVE upload
      {
        rows: [
          { id: 9, status_konfirmasi: 'PENDING', has_ledger_entry: false },
        ],
      }, // prior txns
      { rows: [{ id: 200 }] }, // INSERT uploads
      { rows: [] }, // UPDATE uploads SET SUPERSEDED
      { rows: [] }, // UPDATE transactions SET SUPERSEDED
      { rows: [] }, // INSERT audit_log UPLOAD_SUPERSEDED
      { rows: [{ id: 10, dinas_inisiasi: 'TB', dinas_target: 'TC' }] }, // insert chunk
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.persist({
      rawRows: JSON.stringify([pendingRow()]),
      originalFilename: 'f.xlsx',
      rawDescription: null,
      user: uploader,
      ip: null,
    });

    expect(result.superseded_upload_ids).toEqual([50]);
    expect(result.superseded_transaction_count).toBe(1);
    const auditCall = client.query.mock.calls[5];
    expect((auditCall[1] as unknown[])[1]).toBe('UPLOAD_SUPERSEDED');
  });

  test('prior upload WITH a ledger entry blocks the whole persist with 409, no upload/rows written', async () => {
    const client = fakeClient([
      { rows: [{ id: 50 }] }, // lock prior ACTIVE upload
      {
        rows: [
          { id: 9, status_konfirmasi: 'CONFIRMED', has_ledger_entry: true },
        ],
      }, // blocked
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage, record } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    try {
      await service.persist({
        rawRows: JSON.stringify([pendingRow()]),
        originalFilename: 'f.xlsx',
        rawDescription: null,
        user: uploader,
        ip: '10.0.0.1',
      });
      throw new Error('expected persist to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(409);
      expect((err as DomainError).errorCode).toBe('UPLOAD_SUPERSEDE_BLOCKED');
      expect((err as DomainError).errorCategory).toBe('LAINNYA');
    }
    // only the lock + prior-txn query happened — no INSERT INTO uploads reached
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('PersistService.persist — pre-transaction validation (atomicity)', () => {
  test('malformed rows JSON -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.persist({
        rawRows: '{not json',
        originalFilename: 'f.xlsx',
        rawDescription: null,
        user: uploader,
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_ROWS_JSON',
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('missing original_filename -> 400, transaction never opened', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.persist({
        rawRows: JSON.stringify([pendingRow()]),
        originalFilename: '   ',
        rawDescription: null,
        user: uploader,
        ip: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'ORIGINAL_FILENAME_REQUIRED',
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('one row with an over-length reviewer_note rejects the WHOLE batch (all-or-nothing)', async () => {
    const { db, withTransaction } = fakeDb(fakeClient([]));
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.persist({
        rawRows: JSON.stringify([
          pendingRow(),
          pendingRow({ reviewer_note: 'a'.repeat(2001) }),
        ]),
        originalFilename: 'f.xlsx',
        rawDescription: null,
        user: uploader,
        ip: null,
      }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'TEXT_TOO_LONG' });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe('PersistService.persist — description comments', () => {
  test('one comment per distinct dinas_target, skips self-repost pairs', async () => {
    const client = fakeClient([
      { rows: [] },
      { rows: [{ id: 300 }] },
      {
        rows: [
          { id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' },
          { id: 2, dinas_inisiasi: 'TB', dinas_target: 'TC' },
          { id: 3, dinas_inisiasi: 'TB', dinas_target: 'TB' }, // self-repost (EXCLUDED) — skip
        ],
      },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage, post } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await service.persist({
      rawRows: JSON.stringify([
        pendingRow(),
        pendingRow(),
        pendingRow({ dinas_target: 'TB' }),
      ]),
      originalFilename: 'f.xlsx',
      rawDescription: 'cek ya',
      user: uploader,
      ip: null,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(client, {
      dinasInisiasi: 'TB',
      dinasTarget: 'TC',
      implicitRecipientDinas: 'TC',
      fallbackTransactionId: 1,
      authorUserId: 'user-1',
      body: 'cek ya',
    });
  });
});

describe('PersistService.persist — chunked insert', () => {
  test('rows beyond CHUNK_SIZE still land in the SAME transaction, split across 2 INSERTs', async () => {
    const rows = Array.from({ length: CHUNK_SIZE + 1 }, () => pendingRow());
    const chunk1 = Array.from({ length: CHUNK_SIZE }, (_, i) => ({
      id: i + 1,
      dinas_inisiasi: 'TB',
      dinas_target: 'TC',
    }));
    const chunk2 = [
      { id: CHUNK_SIZE + 1, dinas_inisiasi: 'TB', dinas_target: 'TC' },
    ];
    const client = fakeClient([
      { rows: [] },
      { rows: [{ id: 400 }] },
      { rows: chunk1 },
      { rows: chunk2 },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.persist({
      rawRows: JSON.stringify(rows),
      originalFilename: 'big-file.xlsx',
      rawDescription: null,
      user: uploader,
      ip: null,
    });

    expect(result.inserted).toBe(CHUNK_SIZE + 1);
    const insertCalls = client.query.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO rdt.transactions'),
    );
    expect(insertCalls).toHaveLength(2);
  });
});

describe('PersistService.persist — duplicate detection (3.5a, cross-upload)', () => {
  test('a PENDING row whose document_no matches an existing transaction is flagged NEEDS_REVIEW', async () => {
    const existing = {
      id: 77,
      upload_id: 5,
      document_no: 'D1',
      ref_doc: null,
      account: null,
      cost_ctr: null,
      profit_ctr: null,
      item: null,
      in_pclc: null,
      dinas_target: null,
    };
    const client = fakeClient([
      { rows: [] },
      { rows: [{ id: 500 }] },
      { rows: [existing] }, // dup lookup by document_no
      { rows: [{ id: 1, dinas_inisiasi: 'TB', dinas_target: 'TC' }] },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.persist({
      rawRows: JSON.stringify([
        pendingRow({ document_no: 'D1', dinas_target: null, account: null }),
      ]),
      originalFilename: 'f.xlsx',
      rawDescription: null,
      user: uploader,
      ip: null,
    });

    expect(result.duplicates_flagged).toBe(1);
  });
});

describe('PersistService.downloadOriginal', () => {
  const uploadRow = {
    dinas_code: 'TB',
    original_filename: '06. DT TB - Jun 2026.xlsx',
    original_file_path: 'uploads/1-06._DT_TB_-_Jun_2026.xlsx',
  };

  test('upload not found -> 404', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValueOnce({ rows: [] });
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.downloadOriginal(1, { userId: 'u', dinas: 'TB', role: 'staff' }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: 'UPLOAD_NOT_FOUND' });
  });

  test('no original_file_path recorded -> 404', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValueOnce({
      rows: [{ ...uploadRow, original_file_path: null }],
    });
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.downloadOriginal(1, { userId: 'u', dinas: 'TB', role: 'staff' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'ORIGINAL_FILE_NOT_AVAILABLE',
    });
  });

  test('TAB role bypasses dinas authz entirely', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValueOnce({ rows: [uploadRow] });
    const { pairComment, rollbackAudit, storage, getObject } =
      fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    const result = await service.downloadOriginal(1, {
      userId: 'tab-1',
      dinas: 'Corp',
      role: 'TAB',
    });
    expect(result.filename).toBe(uploadRow.original_filename);
    expect(getObject).toHaveBeenCalledWith(uploadRow.original_file_path);
    expect(query).toHaveBeenCalledTimes(1); // no extra authz query needed
  });

  test('initiator dinas is allowed without an extra query', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValueOnce({ rows: [uploadRow] });
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await service.downloadOriginal(1, {
      userId: 'u',
      dinas: 'tb',
      role: 'staff',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('current dinas_target is allowed (direct-target query hits)', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query
      .mockResolvedValueOnce({ rows: [uploadRow] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // direct target match
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await service.downloadOriginal(1, {
      userId: 'u',
      dinas: 'TC',
      role: 'staff',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('past target via REASSIGN/REJECT_REDIRECT audit chain is allowed (no hop limit)', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query
      .mockResolvedValueOnce({ rows: [uploadRow] })
      .mockResolvedValueOnce({ rows: [] }) // not the current target
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // but was a past target in the chain
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await service.downloadOriginal(1, {
      userId: 'u',
      dinas: 'TL',
      role: 'staff',
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  test('unrelated dinas gets 403', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query
      .mockResolvedValueOnce({ rows: [uploadRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { pairComment, rollbackAudit, storage } = fakeCollaborators();
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.downloadOriginal(1, { userId: 'u', dinas: 'TN', role: 'staff' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'FORBIDDEN_DOWNLOAD',
    });
  });

  test('file missing from storage -> 404 even though the DB row is fine', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValueOnce({ rows: [uploadRow] });
    const { pairComment, rollbackAudit, storage, objectExists } =
      fakeCollaborators();
    objectExists.mockResolvedValueOnce(false);
    const service = new PersistService(db, pairComment, rollbackAudit, storage);

    await expect(
      service.downloadOriginal(1, { userId: 'u', dinas: 'TB', role: 'staff' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'ORIGINAL_FILE_MISSING',
    });
  });
});
