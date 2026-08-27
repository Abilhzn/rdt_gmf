import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../api-config';

// `GET period-deadlines/current-reminder` — the ONE non-TAB-gated route on `period-deadlines`
// (every OTHER endpoint there is TAB-only). Used by both the shell's reminder banner
// (shell.component.ts) and features/period-deadlines/'s own setting page — lives in `core/`
// rather than inside `features/period-deadlines/` because the shell (cross-feature) needs it too
// (Batch 6f's prompt: don't bury a cross-cutting service inside one feature's folder).
@Injectable({ providedIn: 'root' })
export class PeriodDeadlineReminderService {
  private readonly base = `${API_BASE}/period-deadlines`;

  constructor(private http: HttpClient) {}

  getCurrentReminder(): Observable<{ periode: string; deadline_at: string | null }> {
    return this.http
      .get<{ periode: string; deadline_at: unknown }>(`${this.base}/current-reminder`)
      .pipe(map((res) => ({ periode: res.periode, deadline_at: (res.deadline_at as string | null) ?? null })));
  }
}
