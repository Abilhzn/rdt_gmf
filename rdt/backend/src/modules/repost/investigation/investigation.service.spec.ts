import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { PairCommentService } from '../shared/pair-comment.service';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { InvestigationService } from './investigation.service';

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
  const pairComment = { post } as unknown as PairCommentService;
  const rollbackAudit = { record } as unknown as RollbackAuditService;
  return { pairComment, rollbackAudit, post, record };
}

const tab = { userId: 'demo-tab', dinas: 'TAB', role: 'TAB' };

const baseInvestigationRow = {
  id: 77,
  status_konfirmasi: 'NEEDS_INVESTIGATION',
  dinas_inisiasi: 'TJ',
  dinas_target: null,
  reassign_count: 0,
  nominal: '5000.00',
};

describe('InvestigationService.listPending', () => {
  test('queries NEEDS_INVESTIGATION rows ordered oldest first', async () => {
    const { db, query } = fakeDb(fakeClient([]));
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    const rows = await service.listPending();

    expect(rows).toEqual([{ id: 1 }]);
    expect(query.mock.calls[0][0]).toContain('ORDER BY t.created_at ASC');
  });
});

describe('InvestigationService.assignOne', () => {
  test('CONFIRMED + exactly 2 ledger entries (DEBIT new target, CREDIT inisiasi), reassigned_from=Ask TA, audit INVESTIGATION_RESOLVED', async () => {
    const client = fakeClient([
      { rows: [{ code: 'TF' }] }, // validCodes (loaded before the lock, see assignOne)
      { rows: [baseInvestigationRow] }, // lock
      { rows: [] }, // UPDATE
      { rows: [] }, // ledger DEBIT
      { rows: [] }, // ledger CREDIT
      { rows: [] }, // audit
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, post } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    const result = await service.assignOne(tab, {
      transactionId: 77,
      newTarget: 'tf',
      rawDescription: null,
      ip: '1.2.3.4',
    });

    expect(result).toEqual({ dinas_target: 'TF' });
    const updateCall = client.query.mock.calls[2];
    expect(String(updateCall[0])).toContain("reassigned_from='Ask TA'");
    expect(String(updateCall[0])).toContain("status_konfirmasi='CONFIRMED'");
    expect(client.query.mock.calls[3][1]).toEqual([
      77,
      'TF',
      'DEBIT',
      '5000.00',
    ]);
    expect(client.query.mock.calls[4][1]).toEqual([
      77,
      'TJ',
      'CREDIT',
      '5000.00',
    ]);
    const auditCall = client.query.mock.calls[5];
    expect(auditCall[1][2]).toBe('INVESTIGATION_RESOLVED');
    expect(auditCall[1][3]).toBe('NEEDS_INVESTIGATION');
    expect(auditCall[1][4]).toBe('CONFIRMED');
    expect(post).not.toHaveBeenCalled(); // no description -> no comment
  });

  test('description present -> posts one pair-comment, konteks = newly-assigned dinas_target', async () => {
    const client = fakeClient([
      { rows: [{ code: 'TF' }] }, // validCodes
      { rows: [baseInvestigationRow] }, // lock
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, post } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    await service.assignOne(tab, {
      transactionId: 77,
      newTarget: 'TF',
      rawDescription: 'sudah dicek',
      ip: null,
    });

    expect(post).toHaveBeenCalledWith(client, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TF',
      implicitRecipientDinas: 'TF', // investigation notifies the newly-assigned dinas, not inisiasi
      fallbackTransactionId: 77,
      authorUserId: 'demo-tab',
      body: 'sudah dicek',
    });
  });

  test('a row not awaiting investigation gets 409, rollback-audit recorded', async () => {
    const client = fakeClient([
      { rows: [{ code: 'TF' }] }, // validCodes
      { rows: [{ ...baseInvestigationRow, status_konfirmasi: 'CONFIRMED' }] }, // lock
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, record } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    try {
      await service.assignOne(tab, {
        transactionId: 77,
        newTarget: 'TF',
        rawDescription: null,
        ip: null,
      });
      throw new Error('expected assignOne to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(409);
      expect((err as DomainError).errorCode).toBe('NOT_NEEDS_INVESTIGATION');
    }
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('InvestigationService.assignAll', () => {
  test('assigns every item inside one transaction, one comment per distinct pair', async () => {
    const client = fakeClient([
      { rows: [{ code: 'TF' }] }, // validCodes (loaded once for the whole batch)
      { rows: [baseInvestigationRow] }, // item 1 lock
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] }, // item 1 update+ledger+ledger+audit
      { rows: [{ ...baseInvestigationRow, id: 78 }] }, // item 2 lock — same pair (TJ -> TF)
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const { db, withTransaction } = fakeDb(client);
    const { pairComment, rollbackAudit, post } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    const result = await service.assignAll(
      tab,
      [
        { transaction_id: 77, dinas_target: 'TF' },
        { transaction_id: 78, dinas_target: 'TF' },
      ],
      'satu deskripsi buat semua',
      null,
    );

    expect(result.assigned).toEqual([
      { id: 77, dinas_inisiasi: 'TJ', dinas_target: 'TF' },
      { id: 78, dinas_inisiasi: 'TJ', dinas_target: 'TF' },
    ]);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    // both items land on the SAME (TJ, TF) pair -> exactly one comment, not two
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ dinasInisiasi: 'TJ', dinasTarget: 'TF' }),
    );
  });

  test('atomicity: one bad item fails the whole batch, rollback-audit recorded via separate connection', async () => {
    const client = fakeClient([
      { rows: [{ code: 'TF' }] }, // validCodes
      { rows: [baseInvestigationRow] }, // item 1 lock — would succeed alone
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] }, // item 2 lock -> not found
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, record } = fakeCollaborators();
    const service = new InvestigationService(db, pairComment, rollbackAudit);

    await expect(
      service.assignAll(
        tab,
        [
          { transaction_id: 77, dinas_target: 'TF' },
          { transaction_id: 999, dinas_target: 'TF' },
        ],
        null,
        null,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'TRANSACTION_NOT_FOUND',
    });

    expect(record).toHaveBeenCalledTimes(1);
  });
});
