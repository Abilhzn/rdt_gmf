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
  /** Populated on both as_initiator/global-pair (buildChainAwareProgress) and, since 1 Agu sore
   * (TAB's restored "Need Identification" sub-view needs the same segmented bar), need_to_confirm
   * (buildNeedToConfirmProgress) rows too. */
  declined_pending_action?: number;
  /** Figma nodes 1:2/69:209 (28 Jul design-detail pass): "N reply" shown on every pair card. */
  reply_count: number;
  /** Only populated on need_to_confirm rows — the REAL dinas_target this pair sits under (TAB's
   * own dinas, or 'Corp' which has no dedicated PIC) — see buildNeedToConfirmProgress. */
  target_dinas?: string;
  /** REQ-RDT-NAV-03 (31 Jul): full redirect breadcrumb, e.g. ['TJ','TC','TL'] — only populated on
   * as_initiator/global-pair rows (buildChainAwareProgress) when every transaction under this
   * card took the exact same path; undefined otherwise (mixed paths, or no redirect at all — a
   * two-point [dinas_inisiasi, target] is always a safe fallback to render in that case). */
  chain?: string[];
  /** REQ-RDT-SAP-07 (state label dinamis) / REQ-RDT-NAV-02 (diperjelas 1 Agu): "who's holding the
   * ball" for this pair right now — "Waiting for confirmation [Role]" / "Waiting to repost" /
   * "Reposted by TAB with subdoc [...]". Computed server-side (rules/stateLabel.js), sent on
   * BOTH need_to_confirm (buildNeedToConfirmProgress) and as_initiator/global-pair
   * (buildChainAwareProgress) rows — shown on Dashboard cards now, not just Need Approval/Riwayat. */
  state_label?: string;
  /** REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): PENDING count, for the segmented progress bar's
   * "Open" segment — populated on as_initiator/global-pair rows (buildChainAwareProgress) and,
   * since 1 Agu sore, need_to_confirm rows too (buildNeedToConfirmProgress, for TAB's restored
   * "Need Identification" Dashboard sub-view). "Confirmed" segment = `resolved`, "Declined"
   * segment = `declined_pending_action`. */
  open?: number;
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

// REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): the KPI summary row atop the "Report Submission"
// (PIC) / "Summary Progress All Dinas" (TAB) page. is_global_view distinguishes which fields are
// populated, same role-split as DashboardSummary above.
export interface DashboardKpis {
  is_global_view: boolean;
  // PIC (own dinas_inisiasi only)
  total_transaksi?: number;
  total_nilai?: number;
  pasangan_count?: number;
  open_count?: number;
  resolved_count?: number;
  // TAB (system-wide)
  dinas_aktif?: number;
  butuh_investigasi?: number;
  waiting_to_repost?: number;
  reposted?: number;
}

// REQ-RDT-NAV-02 (Figma 78:243, "Progress per Dinas Pengaju") — TAB-only rollup table: one row
// PER SUBMITTING DINAS (sum of all its pairs), not per pair — see dashboard.js's
// GET /per-dinas-rollup header comment for why this is a different shape from the pair cards.
export interface PerDinasRollupRow {
  dinas: string;
  total: number;
  confirmed: number;
  open: number;
  declined: number;
  percent: number;
  status: { kind: 'investigation' | 'reposted'; label: string } | null;
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

  getKpis(): Observable<DashboardKpis> {
    return this.http
      .get<{ ok: boolean; error?: string } & DashboardKpis>(`${this.base}/dashboard/kpis`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat ringkasan KPI');
        return res;
      }));
  }

  getPerDinasRollup(): Observable<PerDinasRollupRow[]> {
    return this.http
      .get<{ ok: boolean; rows: PerDinasRollupRow[]; error?: string }>(`${this.base}/dashboard/per-dinas-rollup`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat rollup per dinas');
        return res.rows;
      }));
  }
}
