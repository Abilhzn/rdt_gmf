import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ReassignmentService } from './reassignment.service';

function fakeClient(queue: unknown[]) {
  return { query: jest.fn(() => Promise.resolve(queue.shift())) };
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

const tab = { userId: 'demo-tab', dinas: 'TAB', role: 'TAB' };
const initiatorPic = { userId: 'demo-pic-tj', dinas: 'TJ', role: 'PIC' };
const otherPic = { userId: 'demo-pic-tf', dinas: 'TF', role: 'PIC' };

const baseDeclinedRow = {
  id: 42,
  status_konfirmasi: 'DECLINED',
  dinas_target: 'TC',
  dinas_inisiasi: 'TJ',
  reassign_count: 0,
};

describe('ReassignmentService.listDeclined', () => {
  test('queries DECLINED rows for this dinas as inisiasi', async () => {
    const query = jest
      .fn<Promise<unknown>, [string, unknown[]?]>()
      .mockResolvedValue({ rows: [{ id: 1 }] });
    const db = { query } as unknown as DatabaseService;
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    const rows = await service.listDeclined('TJ');

    expect(rows).toEqual([{ id: 1 }]);
    expect(query.mock.calls[0][1]).toEqual(['TJ']);
    expect(query.mock.calls[0][0]).toContain("status_konfirmasi='DECLINED'");
  });
});

describe('ReassignmentService.resolveOne — BORNE', () => {
  test('BORNE_BY_INITIATOR, no ledger at all, audit BORNE_BY_INITIATOR', async () => {
    const client = fakeClient([
      { rows: [baseDeclinedRow] }, // lock
      { rows: [] }, // UPDATE status
      { rows: [] }, // audit
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    await service.resolveOne(initiatorPic, {
      id: 42,
      action: 'BORNE',
      newTarget: undefined,
      rawNote: null,
      ip: null,
    });

    expect(client.query).toHaveBeenCalledTimes(3);
    const updateCall = client.query.mock.calls[1];
    expect(String(updateCall[0])).toContain(
      "status_konfirmasi='BORNE_BY_INITIATOR'",
    );
    const ledgerCalls = client.query.mock.calls.filter((c) =>
      String(c[0]).includes('ledger_entries'),
    );
    expect(ledgerCalls).toHaveLength(0);
    const auditCall = client.query.mock.calls[2];
    expect(String(auditCall[0])).toContain("'BORNE_BY_INITIATOR'");
  });

  test("TAB may also resolve any dinas' declined row", async () => {
    const client = fakeClient([
      { rows: [baseDeclinedRow] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    await expect(
      service.resolveOne(tab, {
        id: 42,
        action: 'BORNE',
        newTarget: undefined,
        rawNote: null,
        ip: null,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ReassignmentService.resolveOne — REASSIGN', () => {
  test('new dinas_target (active), PENDING, reassign_count+1, periode_efektif NULL, audit REASSIGN', async () => {
    const client = fakeClient([
      { rows: [baseDeclinedRow] }, // lock
      { rows: [{ code: 'TF' }, { code: 'TJ' }, { code: 'TC' }] }, // validCodes
      { rows: [] }, // UPDATE
      { rows: [] }, // audit REASSIGN
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    await service.resolveOne(initiatorPic, {
      id: 42,
      action: 'REASSIGN',
      newTarget: 'tf',
      rawNote: 'coba TF',
      ip: null,
    });

    const updateCall = client.query.mock.calls[2];
    expect(String(updateCall[0])).toContain('periode_efektif=NULL');
    expect(updateCall[1]).toEqual(['TF', 'TC', 42]);
    const auditCall = client.query.mock.calls[3];
    expect(String(auditCall[0])).toContain("'REASSIGN'");
    const detail = JSON.parse(auditCall[1][2] as string) as {
      reassign_count: number;
      note: string;
    };
    expect(detail.reassign_count).toBe(1);
    expect(detail.note).toBe('coba TF');
  });

  test('cap REASSIGN_CAP=3: a 4th reassign attempt is rejected with 400', async () => {
    const client = fakeClient([
      { rows: [{ ...baseDeclinedRow, reassign_count: 3 }] }, // lock
      { rows: [{ code: 'TF' }] }, // validCodes — queried before the cap check throws
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, record } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    try {
      await service.resolveOne(initiatorPic, {
        id: 42,
        action: 'REASSIGN',
        newTarget: 'TF',
        rawNote: null,
        ip: null,
      });
      throw new Error('expected resolveOne to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(400);
      expect((err as DomainError).message).toMatch(/cap/i);
    }
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('ReassignmentService.resolveOne — authorization/status errors', () => {
  test('a non-initiator, non-TAB user gets 403', async () => {
    const client = fakeClient([{ rows: [baseDeclinedRow] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    try {
      await service.resolveOne(otherPic, {
        id: 42,
        action: 'BORNE',
        newTarget: undefined,
        rawNote: null,
        ip: null,
      });
      throw new Error('expected resolveOne to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(403);
      expect((err as DomainError).errorCode).toBe('FORBIDDEN_RESOLVE');
    }
  });

  test('a row that is not DECLINED gets 409', async () => {
    const client = fakeClient([
      { rows: [{ ...baseDeclinedRow, status_konfirmasi: 'PENDING' }] },
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    try {
      await service.resolveOne(initiatorPic, {
        id: 42,
        action: 'BORNE',
        newTarget: undefined,
        rawNote: null,
        ip: null,
      });
      throw new Error('expected resolveOne to throw');
    } catch (err) {
      expect((err as DomainError).statusCode).toBe(409);
      expect((err as DomainError).errorCode).toBe('NOT_DECLINED');
    }
  });

  test('an id that does not exist gets 404', async () => {
    const client = fakeClient([{ rows: [] }]);
    const { db } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    try {
      await service.resolveOne(tab, {
        id: 999,
        action: 'BORNE',
        newTarget: undefined,
        rawNote: null,
        ip: null,
      });
      throw new Error('expected resolveOne to throw');
    } catch (err) {
      expect((err as DomainError).statusCode).toBe(404);
      expect((err as DomainError).errorCode).toBe('TRANSACTION_NOT_FOUND');
    }
  });
});

describe('ReassignmentService.batchResolve — atomicity', () => {
  test('one valid + one invalid item fails the whole batch, nothing committed (withTransaction rethrows)', async () => {
    const client = fakeClient([
      { rows: [baseDeclinedRow] }, // item 1 lock — valid, would succeed on its own
      { rows: [] }, // item 1 UPDATE
      { rows: [] }, // item 1 audit
      { rows: [] }, // item 2 lock -> not found
    ]);
    const { db } = fakeDb(client);
    const { rollbackAudit, record } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    await expect(
      service.batchResolve(
        initiatorPic,
        [
          { id: 42, action: 'BORNE', new_dinas_target: undefined },
          { id: 999, action: 'BORNE', new_dinas_target: undefined },
        ],
        null,
        null,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'TRANSACTION_NOT_FOUND',
    });

    // rollback-audit still recorded via the separate connection despite item 1 having "succeeded"
    // inside the (now rolled back) transaction.
    expect(record).toHaveBeenCalledTimes(1);
  });

  test('all-valid batch resolves every item inside one transaction', async () => {
    const client = fakeClient([
      { rows: [baseDeclinedRow] },
      { rows: [] },
      { rows: [] },
      { rows: [{ ...baseDeclinedRow, id: 43 }] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db, withTransaction } = fakeDb(client);
    const { rollbackAudit } = fakeRollbackAudit();
    const service = new ReassignmentService(db, rollbackAudit);

    const result = await service.batchResolve(
      initiatorPic,
      [
        { id: 42, action: 'BORNE', new_dinas_target: undefined },
        { id: 43, action: 'BORNE', new_dinas_target: undefined },
      ],
      'catatan bersama',
      null,
    );

    expect(result).toEqual({ resolved_count: 2 });
    expect(withTransaction).toHaveBeenCalledTimes(1); // one shared transaction, not one per item
  });
});
