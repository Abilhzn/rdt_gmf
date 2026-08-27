import { DatabaseService } from '../../core/database/database.service';
import type { DirectoryProvider } from '../../core/directory/directory.interface';
import { NotificationService } from './notification.service';

function fakeDb(queue: unknown[]) {
  const query = jest.fn(() => Promise.resolve(queue.shift()));
  const db = { query } as unknown as DatabaseService;
  return { db, query };
}

function fakeDirectory(entries: Record<string, { display_name: string }>) {
  const load = jest.fn().mockResolvedValue(entries);
  return { load } as unknown as DirectoryProvider;
}

describe('NotificationService.getNotifications', () => {
  test('attaches author_display_name from the directory, computes unread_count from the 50 rows returned', async () => {
    const { db, query } = fakeDb([
      {
        rows: [
          {
            id: 1,
            comment_id: 10,
            created_at: '2026-08-01T00:00:00Z',
            read_at: null,
            body: 'cek ya @demo-pic-tc',
            author_user_id: 'demo-tab',
            transaction_id: 100,
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
          },
          {
            id: 2,
            comment_id: 11,
            created_at: '2026-08-02T00:00:00Z',
            read_at: '2026-08-03T00:00:00Z',
            body: 'sudah diproses',
            author_user_id: 'demo-pic-tb',
            transaction_id: 101,
            dinas_inisiasi: 'TB',
            dinas_target: 'TC',
          },
        ],
      },
    ]);
    const directory = fakeDirectory({
      'demo-tab': { display_name: 'TAB (demo)' },
      // demo-pic-tb deliberately absent -- fallback to the raw user id
    });
    const service = new NotificationService(db, directory);

    const result = await service.getNotifications('u-tc-pic');

    expect(result.unread_count).toBe(1);
    expect(result.notifications[0].author_display_name).toBe('TAB (demo)');
    expect(result.notifications[1].author_display_name).toBe('demo-pic-tb'); // fallback
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('n.recipient_user_id = $1');
    expect(params).toEqual(['u-tc-pic']);
  });

  test('user with no notifications -> unread_count 0, empty list', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const directory = fakeDirectory({});
    const service = new NotificationService(db, directory);

    const result = await service.getNotifications('nobody');
    expect(result).toEqual({ unread_count: 0, notifications: [] });
  });
});

describe('NotificationService.markRead', () => {
  test("updates only this user's unread notifications, no transaction needed", async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    const directory = fakeDirectory({});
    const service = new NotificationService(db, directory);

    await service.markRead('u-tc-pic');

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('read_at = now()');
    expect(String(sql)).toContain('recipient_user_id = $1');
    expect(String(sql)).toContain('read_at IS NULL');
    expect(params).toEqual(['u-tc-pic']);
  });
});
