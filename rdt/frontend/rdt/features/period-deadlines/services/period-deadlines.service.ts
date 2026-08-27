import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';

// One TAB-set deadline for a (dinas_inisiasi, dinas_target, periode) triple.
export interface PeriodDeadline {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  periode: string;
  deadline_at: string;
  set_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// One TAB-set default deadline for a periode ALONE, set in advance before any pasangan for that
// periode even exists yet.
export interface PeriodDefaultDeadline {
  periode: string;
  deadline_at: string;
  set_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// One row in "Override Deadline"'s list: a pasangan that's 100% confirmed for this periode but
// un-batched, whose periode_efektif already shifted away from the declared periode (overdue).
export interface OverdueDeadlineEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  periode_efektif: string;
}

// One currently-active (not yet 100% resolved) pasangan for a given periode.
export interface ActivePairEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  open_count: number;
}

// `period-deadlines` — TAB-only on every endpoint EXCEPT `current-reminder` (see
// core/services/period-deadline-reminder.service.ts for that one — it's cross-feature, the shell
// needs it too, so it doesn't live here).
@Injectable({ providedIn: 'root' })
export class PeriodDeadlinesService {
  private readonly base = `${API_BASE}/period-deadlines`;

  constructor(private http: HttpClient) {}

  getPeriodDeadlines(dinasInisiasi?: string, dinasTarget?: string): Observable<PeriodDeadline[]> {
    const params: string[] = [];
    if (dinasInisiasi) params.push(`dinas_inisiasi=${encodeURIComponent(dinasInisiasi)}`);
    if (dinasTarget) params.push(`dinas_target=${encodeURIComponent(dinasTarget)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.http.get<{ deadlines: PeriodDeadline[] }>(`${this.base}${qs}`).pipe(map((res) => res.deadlines));
  }

  // Upsert — setting again for the same (dinas_inisiasi, dinas_target, periode) UPDATES the
  // existing deadline, not a duplicate. Per-pasangan OVERRIDE — for the normal "one deadline for
  // everyone" workflow, see setDefaultPeriodDeadline below.
  setPeriodDeadline(dinasInisiasi: string, dinasTarget: string, periode: string, deadlineAt: string): Observable<PeriodDeadline> {
    return this.http
      .post<{ deadline: PeriodDeadline }>(this.base, { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, periode, deadline_at: deadlineAt })
      .pipe(map((res) => res.deadline));
  }

  // The ONLY Setting Deadline action — upserts the periode-wide default AND sweeps/backfills it
  // onto every currently-active pasangan in that periode, atomically, in one call.
  setDefaultPeriodDeadline(periode: string, deadlineAt: string): Observable<{ deadline: PeriodDefaultDeadline; swept: PeriodDeadline[] }> {
    return this.http.post<{ deadline: PeriodDefaultDeadline; swept: PeriodDeadline[] }>(`${this.base}/default`, { periode, deadline_at: deadlineAt });
  }

  getDefaultPeriodDeadlines(): Observable<PeriodDefaultDeadline[]> {
    return this.http.get<{ deadlines: PeriodDefaultDeadline[] }>(`${this.base}/default`).pipe(map((res) => res.deadlines));
  }

  // Deletable only while its deadline hasn't passed yet (backend's own guard, 400 if already
  // passed) — UI mirrors this by disabling the delete button for a past deadline (see
  // period-deadlines-page.component's canDelete), not just relying on the server error.
  deleteDefaultPeriodDeadline(periode: string): Observable<void> {
    return this.http.delete<{ periode: string }>(`${this.base}/default/${encodeURIComponent(periode)}`).pipe(map(() => undefined));
  }

  // Pasangan yang masih punya transaksi belum selesai (blocking status) di periode ini, un-batched.
  getActivePairs(periode: string): Observable<ActivePairEntry[]> {
    return this.http.get<{ periode: string; active: ActivePairEntry[] }>(`${this.base}/active-pairs?periode=${encodeURIComponent(periode)}`).pipe(map((res) => res.active));
  }

  // "Overdue" list, informational — cap sticky, tidak ada aksi override yang menghapusnya.
  getOverdueDeadlines(periode: string): Observable<OverdueDeadlineEntry[]> {
    return this.http.get<{ periode: string; overdue: OverdueDeadlineEntry[] }>(`${this.base}/overdue?periode=${encodeURIComponent(periode)}`).pipe(map((res) => res.overdue));
  }
}
