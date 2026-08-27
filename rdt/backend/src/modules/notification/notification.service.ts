import { Inject, Injectable } from '@nestjs/common';
import { DIRECTORY_PROVIDER } from '../../core/directory/directory.interface';
import type { DirectoryProvider } from '../../core/directory/directory.interface';
import { DatabaseService } from '../../core/database/database.service';

interface NotificationRow {
  id: number;
  comment_id: number;
  created_at: Date | string;
  read_at: Date | string | null;
  body: string;
  author_user_id: string;
  transaction_id: number;
  dinas_inisiasi: string;
  dinas_target: string | null;
}

export interface NotificationEntry {
  id: number;
  comment_id: number;
  body: string;
  author_user_id: string;
  author_display_name: string;
  dinas_inisiasi: string;
  dinas_target: string | null;
  created_at: Date | string;
  read_at: Date | string | null;
}

export interface NotificationsResponse {
  unread_count: number;
  notifications: NotificationEntry[];
}

/**
 * `notifications` — port `routes/notifications.js` (Batch 5a). @mention notifications: badge
 * counter + list, mark-read. Murni informational -- tak pernah menyentuh state transaksi.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(DIRECTORY_PROVIDER) private readonly directory: DirectoryProvider,
  ) {}

  // GET notifications -- 50 terbaru milik user ini, + author_display_name dari DirectoryProvider
  // (fallback ke author_user_id kalau tak ada di directory). unread_count dihitung dari 50 hasil
  // ini (bukan query count terpisah) -- port apa adanya.
  async getNotifications(userId: string): Promise<NotificationsResponse> {
    const [{ rows }, directory] = await Promise.all([
      this.db.query<NotificationRow>(
        `SELECT n.id, n.comment_id, n.created_at, n.read_at,
                c.body, c.author_user_id, c.transaction_id,
                t.dinas_inisiasi, t.dinas_target
         FROM rdt.notifications n
         JOIN rdt.comments c ON c.id = n.comment_id
         JOIN rdt.transactions t ON t.id = c.transaction_id
         WHERE n.recipient_user_id = $1
         ORDER BY n.created_at DESC
         LIMIT 50`,
        [userId],
      ),
      this.directory.load(),
    ]);

    const notifications: NotificationEntry[] = rows.map((n) => ({
      id: n.id,
      comment_id: n.comment_id,
      body: n.body,
      author_user_id: n.author_user_id,
      author_display_name:
        directory[n.author_user_id]?.display_name ?? n.author_user_id,
      dinas_inisiasi: n.dinas_inisiasi,
      dinas_target: n.dinas_target,
      created_at: n.created_at,
      read_at: n.read_at,
    }));
    const unreadCount = notifications.filter((n) => !n.read_at).length;
    return { unread_count: unreadCount, notifications };
  }

  // POST notifications/mark-read -- statement tunggal, tak perlu transaksi.
  async markRead(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE rdt.notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL',
      [userId],
    );
  }
}
