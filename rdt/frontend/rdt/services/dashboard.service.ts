import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface DinasProgress {
  dinas: string;
  total: number;
  resolved: number;
  percent: number;
  /** Only populated on as_initiator rows — buildNeedToConfirmProgress doesn't compute it. */
  declined_pending_action?: number;
  /** Figma nodes 1:2/69:209 (28 Jul design-detail pass): "N reply" shown on every pair card. */
  reply_count: number;
  /** Only populated on need_to_confirm rows — the REAL dinas_target this pair sits under (TAB's
   * own dinas, or 'Corp'/'TA' which have no dedicated PIC) — see buildNeedToConfirmProgress. */
  target_dinas?: string;
}

export interface DashboardSummary {
  own_dinas: string;
  as_initiator: DinasProgress[];
  /** Rich per-pair cards (percent + reply count), not just a bare dinas-code list — see
   * routes/dashboard.js's buildNeedToConfirmProgress. */
  need_to_confirm: DinasProgress[];
  /** true for role TAB: as_initiator is a global view across every submitting dinas, grouped
   * by dinas_inisiasi, not the personal "my outgoing submissions" view (TAB doesn't originate
   * reposts itself) — see dashboard.js. */
  is_global_view: boolean;
}

// REQ-RDT-NAV-02 — personalized per the logged-in user's own dinas (see
// src/backend/src/routes/dashboard.js): as_initiator = progress of MY dinas's outgoing
// submissions per target dinas; need_to_confirm = which OTHER dinas have submissions
// waiting on ME to confirm. Both are empty arrays, per the Figma annotations, when there's
// nothing to show — not an error state.
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly base = '/api';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getSummary(): Observable<DashboardSummary> {
    return this.http
      .get<{ ok: boolean; own_dinas: string; as_initiator: DinasProgress[]; need_to_confirm: DinasProgress[]; is_global_view?: boolean; error?: string }>(`${this.base}/dashboard/summary`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat dashboard');
        return { own_dinas: res.own_dinas, as_initiator: res.as_initiator, need_to_confirm: res.need_to_confirm, is_global_view: !!res.is_global_view };
      }));
  }

  // REQ-RDT-NAV-02a: lightweight count-only call for the sidebar "Dashboard" badge — NOT
  // getSummary(), which runs the full chain-aware aggregation. See ShellComponent, called once
  // at shell init and refreshed opportunistically on navigation to Dashboard.
  getNeedToConfirmCount(): Observable<number> {
    return this.http
      .get<{ ok: boolean; count: number; error?: string }>(`${this.base}/dashboard/need-to-confirm-count`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat badge dashboard');
        return res.count;
      }));
  }
}
