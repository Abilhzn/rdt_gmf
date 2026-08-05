import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService, DinasProgress, DashboardKpis, PerDinasRollupRow } from '../services/dashboard.service';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-NAV-02/02a — rebuilt to match the updated Figma (nodes 1:2 "Need to Confirm" / 69:209
// "Own Repost"): two switchable sub-views (not a side-by-side two-panel layout), "Need to
// Confirm" default since it's the action item (Own Repost is pure monitoring). Sub-view lives in
// the `sub` query param (?sub=need|own) so it's linkable/shareable and ShellComponent's sidebar
// sub-links (a sibling, not an ancestor of this component) can read it too — see
// ShellComponent.dashboardSubview.
//
// REQ-RDT-UI-05 (4 Agu, KEPUTUSAN FINAL malam): morning's rollback to the pre-Figma donut design
// (git ce06ff2) turned out to overshoot what the project owner actually wanted reverted — after
// being shown screenshots of every historical candidate, commit 3c2d8f5 ("iterasi kedua" by this
// session's own earlier labeling, but the one actually picked after seeing it live) is the
// re-adopted basis for the KPI-row/segmented-bar/per-dinas-rollup-table design below. The A5
// chain-arrow fix in pairTitle() and the NAV-03-revisi routing in onCardClick()/resolvePair()/
// goToDetail() below predate/postdate this back-and-forth independently and were never reverted.
@Component({
  selector: 'rdt-home',
  standalone: false,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  asInitiator: DinasProgress[] = [];
  needToConfirm: DinasProgress[] = [];
  errorMessage = '';
  loaded = false;
  subview: 'need' | 'own' = 'need';
  /** Role TAB sees a global view across every submitting dinas instead of their own outgoing
   * submissions — TAB doesn't originate reposts itself. */
  isGlobalView = false;

  // REQ-RDT-UI-05 (re-adopted from 3c2d8f5): KPI summary row + (TAB only) the per-dinas rollup
  // table — both only ever shown on the 'own' sub-view (Report Submission / Summary Progress All
  // Dinas) and TAB's 'need' sub-view (Need Identification, styled like Report Submission per
  // REQ-RDT-NAV-10). A plain PIC's "Need to Confirm" keeps the donut-card look — no KPI row.
  kpis: DashboardKpis | null = null;
  perDinasRollup: PerDinasRollupRow[] = [];

  /** REQ-RDT-NAV-03 (5 Agu): which card's chain-detail badge is expanded, at most one at a time —
   * keyed the same way pairTitle/onCardClick distinguish cards (kind + the pair's own dinas
   * codes), since 'need' and 'own' lists can both be on screen depending on subview. */
  expandedChainKey: string | null = null;

  constructor(
    private dashboard: DashboardService,
    public currentUser: CurrentUserService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      // REQ-RDT-NAV-10 (1 Agu sore): TAB's "Need Identification" Dashboard sub-view lands on
      // 'own' (Summary Progress All Dinas) by default when no query param is set — an explicit
      // ?sub=need/own always wins. Unchanged for a plain PIC (?sub= unset defaults to 'need').
      const isTab = this.currentUser.current?.role === 'TAB';
      const sub = params.get('sub');
      this.subview = sub === 'need' ? 'need' : sub === 'own' ? 'own' : isTab ? 'own' : 'need';
    });
    this.currentUser.user$.subscribe(() => this.load());
  }

  get myDinas(): string | undefined {
    return this.currentUser.current?.dinas;
  }

  get isTabRole(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // Desain rapih (5 Agu, screenshot pemilik proyek): "Total Nilai Diajukan" harus tampil
  // "Rp 520,3jt" (Rupiah + singkatan juta/miliar + koma sebagai desimal ala Indonesia), bukan
  // angka mentah "520300000" atau "520.300.000" — angka DT bisa gampang tembus ratusan juta,
  // dan raw number di kartu KPI itu sendiri (bukan cuma icon bulat "Rp"-nya) yang bikin kartu
  // kelihatan berantakan/nggak "rapih".
  formatRupiah(value: number | undefined | null): string {
    if (value == null || !isFinite(value)) return 'Rp 0';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1_000_000_000) return `Rp ${sign}${(abs / 1_000_000_000).toFixed(1).replace('.', ',')}M`;
    if (abs >= 1_000_000) return `Rp ${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')}jt`;
    if (abs >= 1_000) return `Rp ${sign}${(abs / 1_000).toFixed(1).replace('.', ',')}rb`;
    return `Rp ${sign}${Math.round(abs)}`;
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    if (!this.currentUser.current) {
      this.asInitiator = [];
      this.needToConfirm = [];
      this.kpis = null;
      this.perDinasRollup = [];
      return;
    }
    this.dashboard.getSummary().subscribe({
      next: (summary) => {
        this.asInitiator = summary.as_initiator;
        this.needToConfirm = summary.need_to_confirm;
        this.isGlobalView = summary.is_global_view;
        this.loaded = true;
      },
      error: (err) => { this.errorMessage = err?.error?.error || err?.message || 'Gagal memuat dashboard'; },
    });
    this.dashboard.getKpis().subscribe({
      next: (kpis) => { this.kpis = kpis; },
      error: () => { /* KPI row is supplementary — don't block the rest of the page on it */ },
    });
    // Only TAB's global view has the per-dinas rollup table (backend also enforces TAB-only).
    if (this.currentUser.current.role === 'TAB') {
      this.dashboard.getPerDinasRollup().subscribe({
        next: (rows) => { this.perDinasRollup = rows; },
        error: () => { /* supplementary — see KPI note above */ },
      });
    }
  }

  // REQ-RDT-NAV-03 REVISI (4 Agu, supersedes B2 from 3 Agu): NOT always Dashboard-Detailing
  // anymore — routing now depends on whether the pair still has anything PENDING. Still
  // outstanding -> straight to the action page (Confirm). Fully resolved -> the read-only
  // summary/history page (Dashboard-Detailing). B2's original motivation (a 'need' card used to
  // lose the rich status view — chain breadcrumb, full thread — that 'own'/Dashboard-Detailing
  // had) still holds for the RESOLVED case, which is exactly when this now lands there.
  //
  // BUG FIX (5 Agu, live report — "403 di /rdt/confirm?from=TJ&target=TMM"): the pending->Confirm
  // shortcut above was firing for 'own' cards too, not just 'need' — but Confirm is the ACTION
  // page for the CONFIRMING dinas (the target), and an 'own' card's viewer is the INITIATOR
  // watching someone else's queue, never authorized to act there (middleware/auth.js's
  // requireDinasAccess correctly 403s them). Only 'need' cards represent something the viewer
  // themselves needs to confirm — 'own' cards always land on Dashboard-Detailing (read-only),
  // pending or not, same as before REQ-RDT-NAV-03 REVISI existed.
  onCardClick(kind: 'need' | 'own', d: DinasProgress): void {
    if (kind === 'need' && d.target_dinas === 'INVESTIGATION') {
      // REQ-RDT-LEDGER-10 (29 Jul): the Investigation/Ask TA pseudo-card (see
      // dashboard.js's fetchInvestigationCounts) goes straight to Confirmation's Investigation
      // sub-tab — it isn't a real (initiator, target) pair, so this pending/resolved split
      // doesn't apply.
      this.goToInvestigation();
      return;
    }
    const pair = this.resolvePair(kind, d);
    if (!pair) return;
    if (kind === 'need' && (d.open || 0) > 0) {
      this.goToConfirmFrom(pair.initiator, pair.target);
    } else {
      this.goToDetail(pair.initiator, pair.target);
    }
  }

  // REQ-RDT-LEDGER-10: same pseudo-card sentinel appears on both panels — 'need' shape has it at
  // target_dinas (dinas = the real initiator), 'own' shape has it at dinas directly for the
  // personal view (target_dinas unset) or at target_dinas for TAB's pair-grouped global view.
  isInvestigationCard(d: DinasProgress): boolean {
    return d.dinas === 'INVESTIGATION' || d.target_dinas === 'INVESTIGATION';
  }

  // Centralizes every pair-card title so the Investigation sentinel never leaks its raw code
  // into the UI as a "dinas name" — REQ-RDT-LEDGER-10 restructure (29 Jul) reuses the same
  // "Investigation/Ask TA" label the Confirmation sub-nav already uses.
  //
  // REQ-RDT-NAV-03 (31 Jul, A5 fix 3 Agu, KEPT through the REQ-RDT-UI-05 design rollback): both
  // 'own' (buildChainAwareProgress) AND 'need' (buildNeedToConfirmProgress) cards now carry a
  // full redirect breadcrumb in d.chain (e.g. ['TJ','TC','TL']) when every transaction under the
  // card agrees on the same path — render that instead of just the two endpoints when present.
  // Previously 'need' cards were hardcoded to stay two-point on the (mistaken) assumption they
  // never see a redirect — but a 'need' card groups by the CURRENT dinas_target, which is exactly
  // what a chain member sees, so the same "chain arrow missing" bug applied here too.
  pairTitle(kind: 'need' | 'own', d: DinasProgress): string {
    const label = (code: string | undefined) => (code === 'INVESTIGATION' ? 'Investigation/Ask TA' : code);
    if (d.chain?.length) return d.chain.map((c) => label(c)).join(' → ');
    if (kind === 'need') return `${d.dinas} → ${label(d.target_dinas) || this.myDinas || ''}`;
    if (this.isGlobalView) return `${d.dinas} → ${label(d.target_dinas)}`;
    return `${this.myDinas || ''} → ${label(d.dinas)}`;
  }

  // REQ-RDT-NAV-03 (5 Agu, project owner-approved mockup): badge collapsed by default, click
  // expands sideways. At most one card expanded at a time (clicking a second one closes the
  // first) — same "one at a time" convention as need-approval.component's expandedPairKey.
  private chainKey(kind: 'need' | 'own', d: DinasProgress): string {
    return `${kind}:${d.dinas}:${d.target_dinas || ''}`;
  }

  isChainExpanded(kind: 'need' | 'own', d: DinasProgress): boolean {
    return this.expandedChainKey === this.chainKey(kind, d);
  }

  toggleChainExpand(kind: 'need' | 'own', d: DinasProgress): void {
    const key = this.chainKey(kind, d);
    this.expandedChainKey = this.expandedChainKey === key ? null : key;
  }

  goToInvestigation(): void {
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], { relativeTo: shellRoute, queryParams: { target: 'INVESTIGATION' } });
  }

  // B2 (3 Agu): 'need' shape is ALREADY (dinas=initiator, target_dinas=target), same as
  // 'own'+global (TAB's pair-grouped global view, dashboard.js's buildChainAwareProgress
  // groupBy:'pair'). Personal 'own' cards (a plain PIC's own submissions) are the opposite:
  // dinas=target, this viewer's own dinas is the implicit initiator.
  private resolvePair(kind: 'need' | 'own', d: DinasProgress): { initiator: string; target: string } | null {
    const myDinas = this.currentUser.current?.dinas;
    const usesRowAsIs = kind === 'need' || this.isGlobalView;
    const initiator = usesRowAsIs ? d.dinas : myDinas;
    const target = usesRowAsIs ? d.target_dinas : d.dinas;
    if (!initiator || !target) return null;
    return { initiator, target };
  }

  // targetDinas (28 Jul bug fix): the REAL queue this pair sits under — without it, Confirmation
  // always defaulted to the viewer's own dinas, so TAB clicking a TA-targeted card landed on an
  // empty TAB queue instead of TA's.
  //
  // BUG FIX (28 Jul, live report — "kenapa error?"): the string token '../../confirm' threw
  // NG04002 "Cannot match any routes" every time this was clicked — counting '../' hops by hand
  // across a lazy-loaded module boundary (HomeModule) doesn't reliably land where the comment
  // above (now corrected) assumed it would. Walking the ActivatedRoute OBJECT tree up to the
  // shell (this.route.parent = 'dashboard', .parent.parent = the shell's own '' route) and
  // resolving 'confirm' relative to THAT is unambiguous regardless of nesting/lazy boundaries.
  goToConfirmFrom(dinas: string, targetDinas: string): void {
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], { relativeTo: shellRoute, queryParams: { from: dinas, target: targetDinas } });
  }

  // REQ-RDT-NAV-03: drill-down needs a real (initiator, target) PAIR (see resolvePair above).
  // 'detail/...' is a sibling of HomeComponent's own '' route within HomeModule (see
  // home.module.ts) — NOT '../detail': HomeComponent's own route consumes zero URL segments
  // (path ''), so Angular resolves siblings directly relative to it without an extra '../' hop
  // (verified empirically — '../detail' overshot past the 'dashboard' lazy-module mount entirely).
  goToDetail(initiator: string, target: string): void {
    this.router.navigate(['detail', initiator, target], { relativeTo: this.route });
  }

  // Item 5: 3-color progress ring. 100% = blue (done). Below 100% but at/above half = yellow
  // (still needs confirmation, but on track). Below half = red (needs attention).
  ringColor(percent: number): '#006298' | '#f2b400' | '#b3261e' {
    if (percent >= 100) return '#006298';
    if (percent < 50) return '#b3261e';
    return '#f2b400';
  }

  // REQ-RDT-UI-05 (re-adopted from 3c2d8f5): 3-segment horizontal bar (Confirmed/Open/Declined)
  // on the 'own'/TAB-'need' pair cards. "Confirmed" here means `resolved` (CONFIRMED+
  // BORNE_BY_INITIATOR combined, same definition `percent` already uses elsewhere) — introducing
  // a second "confirmed" definition just for this bar would contradict the number next to it.
  barSegments(d: DinasProgress): { confirmedPct: number; openPct: number; declinedPct: number } {
    const total = d.total || 0;
    if (!total) return { confirmedPct: 0, openPct: 0, declinedPct: 0 };
    const declined = d.declined_pending_action || 0;
    const open = d.open || 0;
    return {
      confirmedPct: (d.resolved / total) * 100,
      openPct: (open / total) * 100,
      declinedPct: (declined / total) * 100,
    };
  }

  // Status pill tone for the per-dinas rollup table.
  rollupStatusClass(row: PerDinasRollupRow): string {
    return row.status ? `rollup-status--${row.status.kind}` : '';
  }

  // state_label pill is color-coded by status (amber "Waiting for confirmation X", blue "Waiting
  // to repost", green "Reposted..."/subdoc). Matched on the label TEXT (see backend's
  // stateLabel.js — it's a derived string, not a stored enum) rather than duplicating
  // deriveStateLabel's branching here.
  stateLabelClass(label: string): string {
    // Guard added 5 Agu: the bar-left pill is now ALWAYS rendered (see home.component.html's
    // symmetry fix) so this can be called with an empty/undefined label -- used to be safe
    // because the pill's *ngIf kept this from ever running on a falsy label.
    if (!label) return '';
    if (label.startsWith('Waiting for confirmation')) return 'pair-card__state-label--amber';
    if (label.startsWith('Waiting to repost')) return 'pair-card__state-label--blue';
    if (label.startsWith('Reposted')) return 'pair-card__state-label--green';
    return '';
  }
}
