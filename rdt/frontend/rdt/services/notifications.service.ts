import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { Notification } from './notification.model';

// Simple @mention notification badge + list. Purely informational: reading/marking-read never
// touches transaction state (see routes/notifications.js).
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly base = '/api/notifications';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  list(): Observable<{ unreadCount: number; notifications: Notification[] }> {
    return this.http
      .get<{ ok: boolean; unread_count: number; notifications: Notification[]; error?: string }>(this.base, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat notifikasi');
        return { unreadCount: res.unread_count, notifications: res.notifications };
      }));
  }

  markRead(): Observable<void> {
    return this.http
      .post<{ ok: boolean }>(`${this.base}/mark-read`, {}, { headers: this.currentUser.authHeaders() })
      .pipe(map(() => undefined));
  }
}
