import { EmployeeDirectory } from '../../../core/directory/directory.interface';
import { PairCommentService } from './pair-comment.service';

const directory: EmployeeDirectory = {
  'demo-pic-tj': { dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ' },
  'demo-pic-tf': { dinas: 'TF', role: 'PIC', display_name: 'PIC TF' },
  'demo-pic-tmm': { dinas: 'TMM', role: 'PIC', display_name: 'PIC TMM' },
  'demo-tab': { dinas: 'TAB', role: 'TAB', display_name: 'TAB' },
};

function fakeClient(queue: unknown[]) {
  return { query: jest.fn(() => Promise.resolve(queue.shift())) };
}

describe('PairCommentService', () => {
  test('replies to the latest top-level thread when one already exists for the pair', async () => {
    const client = fakeClient([
      { rows: [{ id: 7, transaction_id: 100 }] }, // existing parent
      { rows: [{ id: 9 }] }, // INSERT comment RETURNING id
    ]);
    const service = new PairCommentService({
      load: () => Promise.resolve(directory),
    });

    await service.post(client as never, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TMM',
      implicitRecipientDinas: 'TJ',
      fallbackTransactionId: 42,
      authorUserId: 'demo-pic-tmm',
      body: 'cek ya',
    });

    // reply anchored to the EXISTING thread's transaction_id/parent, not the fallback
    const insertCall = client.query.mock.calls[1];
    expect(insertCall[1]).toEqual([100, 7, 'demo-pic-tmm', 'cek ya']);
    // recipient = everyone in implicitRecipientDinas (TJ), minus the author
    const notifCall = client.query.mock.calls[2];
    expect(notifCall[1]).toEqual(['demo-pic-tj', 9]);
  });

  test('starts a new top-level comment (fallback transaction id) when the pair has no thread yet', async () => {
    const client = fakeClient([
      { rows: [] }, // no existing parent
      { rows: [{ id: 5 }] },
    ]);
    const service = new PairCommentService({
      load: () => Promise.resolve(directory),
    });

    await service.post(client as never, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TF',
      implicitRecipientDinas: 'TF', // investigation convention: notify the newly-assigned dinas
      fallbackTransactionId: 42,
      authorUserId: 'demo-tab',
      body: 'assigned to TF',
    });

    const insertCall = client.query.mock.calls[1];
    expect(insertCall[1]).toEqual([42, null, 'demo-tab', 'assigned to TF']);
    const notifCall = client.query.mock.calls[2];
    expect(notifCall[1]).toEqual(['demo-pic-tf', 5]);
  });

  test('mention is scoped to the pair — a mention outside (dinasInisiasi,dinasTarget) does not leak a notification', async () => {
    const client = fakeClient([{ rows: [] }, { rows: [{ id: 1 }] }]);
    const service = new PairCommentService({
      load: () => Promise.resolve(directory),
    });

    await service.post(client as never, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TMM',
      implicitRecipientDinas: 'TJ',
      fallbackTransactionId: 42,
      authorUserId: 'demo-tab',
      body: 'cc @TF please note', // TF is not part of the (TJ, TMM) pair
    });

    const notifCalls = client.query.mock.calls.slice(2).map((c) => c[1]);
    expect(notifCalls).toEqual([['demo-pic-tj', 1]]); // only the implicit recipient, no TF leak
  });

  test('never notifies the author even if they match the implicit recipient dinas', async () => {
    const client = fakeClient([{ rows: [] }, { rows: [{ id: 2 }] }]);
    const service = new PairCommentService({
      load: () => Promise.resolve(directory),
    });

    await service.post(client as never, {
      dinasInisiasi: 'TJ',
      dinasTarget: 'TMM',
      implicitRecipientDinas: 'TJ',
      fallbackTransactionId: 42,
      authorUserId: 'demo-pic-tj', // author IS the one PIC in the implicit-recipient dinas
      body: 'note to self, sort of',
    });

    expect(client.query.mock.calls.length).toBe(2); // no notification INSERT at all
  });
});
