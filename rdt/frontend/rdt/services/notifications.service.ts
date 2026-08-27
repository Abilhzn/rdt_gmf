import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { Notification } from '../shared/models/notification.model';

// Simple @mention notification badge + list. Purely informational: reading/marking-read never
// touches transaction state (see routes/notifications.js).
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly base = '/api/notifications';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  list(): Observable<{ unreadCount: number; notifications: Notification[] }> {
    // backend wraps successful responses as `{ data, message }` — ResponseUnwrapInterceptor
    // (app.config.ts) already strips that envelope, so `res` here is the plain
    // `{ unread_count, notifications }` payload. (Previously this expected a stale `{ ok, ... }`
    // shape from the old Express route that no longer exists, so `!res.ok` was always true and
    // every call silently threw — the bell always showed "no notifications" regardless of data.)
    return this.http
      .get<{ unread_count: number; notifications: Notification[] }>(this.base, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => ({ unreadCount: res.unread_count, notifications: res.notifications })));
  }

  markRead(): Observable<void> {
    return this.http
      .post<{ ok: boolean }>(`${this.base}/mark-read`, {}, { headers: this.currentUser.authHeaders() })
      .pipe(map(() => undefined));
  }
}
