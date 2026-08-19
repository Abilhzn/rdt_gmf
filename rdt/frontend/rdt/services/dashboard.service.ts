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
  /** Populated on both as_initiator/global-pair (buildChainAwareProgress) and need_to_confirm
   * (buildNeedToConfirmProgress) rows. */
  declined_pending_action?: number;
  /** "N reply" shown on every pair card. */
  reply_count: number;
  /** Only populated on need_to_confirm rows — the REAL dinas_target this pair sits under (TAB's
   * own dinas, or 'Corp' which has no dedicated PIC) — see buildNeedToConfirmProgress. */
  target_dinas?: string;
  /** Full redirect breadcrumb, e.g. ['TJ','TC','TL'] — only populated on as_initiator/global-pair
   * rows when every transaction under this card took the exact same path; undefined otherwise
   * (mixed paths, or no redirect — a two-point [dinas_inisiasi, target] is always a safe
   * fallback to render in that case). */
  chain?: string[];
  /** "Who's holding the ball" for this pair right now — "Waiting for confirmation [Role]" /
   * "Waiting to repost" / "Reposted by TAB with subdoc [...]". Computed server-side
   * (rules/stateLabel.js), sent on both need_to_confirm and as_initiator/global-pair rows. */
  state_label?: string;
  /** PENDING count, for the segmented progress bar's "Open" segment — populated on
   * as_initiator/global-pair and need_to_confirm rows. "Confirmed" segment = `resolved`,
   * "Declined" segment = `declined_pending_action`. */
  open?: number;
  /** True when this pair's periode_efektif has shifted away from its declared period (deadline
   * passed) — same "declared vs MAX(periode_efektif)" comparison exportBatches.js's GET /history
   * uses. */
  overdue?: boolean;
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

// The KPI summary row atop the "Report Submission" (PIC) / "Summary Progress All Dinas" (TAB)
// page. is_global_view distinguishes which fields are populated, same role-split as
// DashboardSummary above.
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

// TAB-only rollup table: one row PER SUBMITTING DINAS (sum of all its pairs), not per pair — see
// dashboard.js's GET /per-dinas-rollup header comment for why this is a different shape from the
// pair cards.
export interface PerDinasRollupRow {
  dinas: string;
  total: number;
  confirmed: number;
  open: number;
  declined: number;
  percent: number;
  status: { kind: 'investigation' | 'reposted'; label: string } | null;
}

// Personalized per the logged-in user's own dinas: as_initiator = progress of MY dinas's outgoing
// submissions per target dinas; need_to_confirm = which OTHER dinas have submissions waiting on ME
// to confirm. Both are empty arrays when there's nothing to show — not an error state.
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

  // Lightweight count-only call for the sidebar "Dashboard" badge — NOT getSummary(), which runs
  // the full chain-aware aggregation. Called once at shell init and refreshed opportunistically
  // on navigation to Dashboard.
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

  // The pecahan behind one rollup row's summed total, one entry per (dinasInisiasi, target)
  // pasangan — same shape as the pair cards buildChainAwareProgress returns for the global
  // as_initiator view, so DinasProgress is reused as-is rather than adding a near-duplicate type.
  getBreakdown(dinasInisiasi: string): Observable<DinasProgress[]> {
    return this.http
      .get<{ ok: boolean; pairs: DinasProgress[]; error?: string }>(`${this.base}/dashboard/summary/${encodeURIComponent(dinasInisiasi)}/breakdown`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat breakdown per pasangan');
        return res.pairs;
      }));
  }
}
