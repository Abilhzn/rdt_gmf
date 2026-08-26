import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { PairCommentService } from '../shared/pair-comment.service';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ConfirmationService } from './confirmation.service';

// Fake pg client: each test pre-loads a queue of query results consumed in call order — mirrors
// how health.controller.spec.ts fakes DatabaseService, just extended for a multi-query flow.
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

const baseLockedRow = {
  id: 42,
  status_konfirmasi: 'PENDING',
  dinas_target: 'TC',
  dinas_inisiasi: 'TB',
  nominal: '1000.00',
  account: 'ACC-1',
  remark: 'remark',
  ref_doc: 'REF-1',
  reassign_count: 0,
  period: null, // no declared period -> snapshotPeriodeEfektif is a no-op, keeps fixtures short
};

describe('ConfirmationService.getQueue', () => {
  test('attaches upload_filename join and a breadcrumb chain for reassigned rows', async () => {
    const db = {
      query: jest
        .fn()
        // GET queue query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              dinas_inisiasi: 'TB',
              dinas_target: 'TC',
              reassign_count: 1,
              upload_filename: 'f.xlsx',
            },
            {
              id: 2,
              dinas_inisiasi: 'TF',
              dinas_target: 'TC',
              reassign_count: 0,
              upload_filename: 'f.xlsx',
            },
          ],
        })
        // audit_log REASSIGN/REJECT_REDIRECT chain query (only for id=1, reassign_count>0)
        .mockResolvedValueOnce({
          rows: [{ transaction_id: 1, detail: { from_dinas: 'TL' } }],
        }),
    } as unknown as DatabaseService;
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    const rows = await service.getQueue('TC');

    expect(rows[0].chain).toEqual(['TB', 'TL', 'TC']);
    expect(rows[1].chain).toEqual(['TF', 'TC']); // never reassigned -> no audit query hit, no hop
  });
});

describe('ConfirmationService.submit — CONFIRM', () => {
  test('writes 2 ledger entries (DEBIT target, CREDIT inisiasi) + audit CONFIRM', async () => {
    const client = fakeClient([
      { rows: [baseLockedRow] }, // lock
      { rows: [] }, // UPDATE status
      { rows: [] }, // ledger DEBIT
      { rows: [] }, // ledger CREDIT
      { rows: [] }, // audit CONFIRM
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    const result = await service.submit(
      'TC',
      'user-1',
      [{ id: 42, claim: 'YA' }],
      null,
      '127.0.0.1',
    );

    expect(result).toEqual({ declined: [], redirected: [] });
    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls[2]).toContain('INSERT INTO rdt.ledger_entries');
    expect(client.query.mock.calls[2][1]).toEqual([42, 'TC', '1000.00']); // DEBIT target
    expect(client.query.mock.calls[3][1]).toEqual([42, 'TB', '1000.00']); // CREDIT inisiasi
    expect(calls[4]).toContain('action,status_before,status_after');
    expect(client.query.mock.calls[4][1][0]).toBe('user-1');
  });
});

describe('ConfirmationService.submit — DECLINE (tanpa redirect_to)', () => {
  test('DECLINED + audit DECLINE, tanpa ledger entry apa pun', async () => {
    const client = fakeClient([
      { rows: [baseLockedRow] }, // lock
      { rows: [] }, // UPDATE status DECLINED
      { rows: [] }, // audit DECLINE
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    const result = await service.submit(
      'TC',
      'user-1',
      [{ id: 42, claim: 'TIDAK' }],
      null,
      null,
    );

    expect(result.declined).toEqual([
      {
        id: 42,
        account: 'ACC-1',
        nominal: '1000.00',
        remark: 'remark',
        ref_doc: 'REF-1',
        dinas_inisiasi: 'TB',
      },
    ]);
    expect(result.redirected).toEqual([]);
    expect(client.query).toHaveBeenCalledTimes(3);
    const ledgerCalls = client.query.mock.calls.filter((c) =>
      String(c[0]).includes('ledger_entries'),
    );
    expect(ledgerCalls).toHaveLength(0);
  });
});

describe('ConfirmationService.submit — REJECT_REDIRECT', () => {
  test('dinas_target baru, reassign_count+1, periode_efektif NULL, audit REJECT_REDIRECT, tanpa ledger', async () => {
    const client = fakeClient([
      { rows: [baseLockedRow] }, // lock
      { rows: [{ code: 'TF' }, { code: 'TB' }, { code: 'TC' }] }, // validCodes (is_active=true)
      { rows: [] }, // UPDATE dinas_target/reassign_count
      { rows: [] }, // audit REJECT_REDIRECT
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    const result = await service.submit(
      'TC',
      'user-1',
      [{ id: 42, claim: 'TIDAK', redirect_to: 'tf' }],
      null,
      null,
    );

    expect(result.redirected).toEqual([
      {
        id: 42,
        account: 'ACC-1',
        nominal: '1000.00',
        remark: 'remark',
        ref_doc: 'REF-1',
        dinas_inisiasi: 'TB',
        redirected_to: 'TF', // preserves actual stored case, per reassignmentRules (3a)
      },
    ]);
    const updateCall = client.query.mock.calls[2];
    expect(String(updateCall[0])).toContain('periode_efektif=NULL');
    expect(updateCall[1]).toEqual(['TF', 'TC', 42]);
    const ledgerCalls = client.query.mock.calls.filter((c) =>
      String(c[0]).includes('ledger_entries'),
    );
    expect(ledgerCalls).toHaveLength(0);
  });

  test('invalid redirect target (e.g. back to dinas_inisiasi) throws before any write, batch rolled back', async () => {
    const client = fakeClient([
      { rows: [baseLockedRow] }, // lock
      { rows: [{ code: 'TB' }, { code: 'TC' }] }, // validCodes
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    await expect(
      service.submit(
        'TC',
        'user-1',
        [{ id: 42, claim: 'TIDAK', redirect_to: 'TB' }],
        null,
        null,
      ),
    ).rejects.toThrow(DomainError);
    // only lock + validCodes query happened — no UPDATE/INSERT reached
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});

describe('ConfirmationService.submit — description', () => {
  test('delegates one reply per dinas_inisiasi to PairCommentService, konteks = dinas_inisiasi', async () => {
    const client = fakeClient([
      { rows: [baseLockedRow] }, // lock
      { rows: [] }, // UPDATE status DECLINED
      { rows: [] }, // audit DECLINE
    ]);
    const { db } = fakeDb(client);
    const { pairComment, post, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    await service.submit(
      'TC',
      'user-1',
      [{ id: 42, claim: 'TIDAK' }],
      'cek ya',
      null,
    );

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(client, {
      dinasInisiasi: 'TB',
      dinasTarget: 'TC',
      implicitRecipientDinas: 'TB', // confirmation notifies dinas_inisiasi, not dinas_target
      fallbackTransactionId: 42,
      authorUserId: 'user-1',
      body: 'cek ya',
    });
  });
});

describe('ConfirmationService.submit — atomicity + rollback audit 🔴', () => {
  test('a bad decision (unknown id) fails the whole batch and delegates a ROLLBACK audit to RollbackAuditService', async () => {
    const client = fakeClient([
      { rows: [] }, // lock query for a non-existent id -> "transaction not found"
    ]);
    const { db } = fakeDb(client);
    const { pairComment, rollbackAudit, record } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    try {
      await service.submit(
        'TC',
        'user-1',
        [{ id: 999, claim: 'YA' }],
        null,
        '10.0.0.1',
      );
      throw new Error('expected submit to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(500);
      expect((err as DomainError).errorCode).toBe('CONFIRMATION_SUBMIT_FAILED');
      expect((err as DomainError).errorCategory).toBe('LAINNYA');
    }

    // The ROLLBACK audit must go through RollbackAuditService (koneksi TERPISAH dari pool,
    // autocommit — NOT client.query, the transaction's own client which just rolled back).
    expect(record).toHaveBeenCalledTimes(1);
    const [args] = record.mock.calls[0] as [
      { userId: string; ip: string | null; err: unknown; route: string },
    ];
    expect(args.userId).toBe('user-1');
    expect(args.route).toBe('repost/confirmation/:dinas/submit');
    expect((args.err as Error).message).toContain('transaction not found: 999');
  });

  test('invalid description (over 2000 chars) is rejected before any transaction is opened', async () => {
    const client = fakeClient([]);
    const { db, withTransaction } = fakeDb(client);
    const { pairComment, rollbackAudit } = fakeCollaborators();
    const service = new ConfirmationService(db, pairComment, rollbackAudit);

    await expect(
      service.submit('TC', 'user-1', [], 'a'.repeat(2001), null),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'TEXT_TOO_LONG' });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
