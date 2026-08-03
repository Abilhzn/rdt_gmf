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

  // REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): KPI summary row + (TAB only) the per-dinas
  // rollup table — both only ever shown on the 'own' sub-view (Report Submission / Summary
  // Progress All Dinas), matching the two Figma frames this was pulled from. 'need' (Need to
  // Confirm) keeps its pre-existing donut-card look — no updated design was provided for it.
  kpis: DashboardKpis | null = null;
  perDinasRollup: PerDinasRollupRow[] = [];

  constructor(
    private dashboard: DashboardService,
    public currentUser: CurrentUserService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      // REQ-RDT-NAV-10 (1 Agu sore, reversed): TAB's "Need Identification" Dashboard sub-view is
      // back — an explicit ?sub=need/own always wins; with no query param, TAB still LANDS on
      // 'own' (Summary Progress All Dinas) by default, same as right after the merge, just no
      // longer the ONLY option. Unchanged for a plain PIC (?sub= unset defaults to 'need').
      const isTab = this.currentUser.current?.role === 'TAB';
      const sub = params.get('sub');
      this.subview = sub === 'need' ? 'need' : sub === 'own' ? 'own' : isTab ? 'own' : 'need';
    });
    this.currentUser.user$.subscribe(() => this.load());
  }

  get myDinas(): string | undefined {
    return this.currentUser.current?.dinas;
  }

  // REQ-RDT-NAV-10 (1 Agu sore, project owner request): TAB's "Need Identification" Dashboard
  // sub-view was retired when the merge with the Confirmation nav item happened — restored here,
  // now styled like Report Submission/Summary Progress (segmented bar + KPI row) instead of the
  // old donut. Unchanged for a plain PIC (donut, no KPI row, label stays "Need to Confirm").
  get isTabRole(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    if (!this.currentUser.current) { this.asInitiator = []; this.needToConfirm = []; this.kpis = null; this.perDinasRollup = []; return; }
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

  // Single delegated click handler for the shared #pairCard template (see home.component.html) —
  // 'need' cards drill into Confirmation, 'own' cards drill into Dashboard-Detailing.
  onCardClick(kind: 'need' | 'own', d: DinasProgress): void {
    if (kind === 'need') {
      // REQ-RDT-LEDGER-10 (29 Jul): the Investigation/Ask TA pseudo-card (see
      // dashboard.js's fetchInvestigationCounts) goes straight to Confirmation's Investigation
      // sub-tab — it isn't a real (initiator, target) pair, so goToConfirmFrom's ?from= filter
      // doesn't apply here.
      if (d.target_dinas === 'INVESTIGATION') { this.goToInvestigation(); return; }
      this.goToConfirmFrom(d.dinas, d.target_dinas);
    } else {
      this.goToDetail(d);
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
  // REQ-RDT-NAV-03 (31 Jul): 'own' cards (buildChainAwareProgress) carry a full redirect
  // breadcrumb in d.chain (e.g. ['TJ','TC','TL']) when every transaction under the card agrees
  // on the same path — render that instead of just the two endpoints when present. 'need' cards
  // (buildNeedToConfirmProgress) never redirect on dinas_inisiasi, so they stay two-point.
  pairTitle(kind: 'need' | 'own', d: DinasProgress): string {
    const label = (code: string | undefined) => (code === 'INVESTIGATION' ? 'Investigation/Ask TA' : code);
    if (kind === 'need') return `${d.dinas} → ${label(d.target_dinas) || this.myDinas || ''}`;
    if (d.chain?.length) return d.chain.map((c) => label(c)).join(' → ');
    if (this.isGlobalView) return `${d.dinas} → ${label(d.target_dinas)}`;
    return `${this.myDinas || ''} → ${label(d.dinas)}`;
  }

  goToInvestigation(): void {
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], { relativeTo: shellRoute, queryParams: { target: 'INVESTIGATION' } });
  }

  // targetDinas (28 Jul bug fix): the REAL queue this pair sits under (see DinasProgress.target_dinas)
  // — without it, Confirmation always defaulted to the viewer's own dinas, so TAB clicking a
  // TA-targeted card landed on an empty TAB queue instead of TA's.
  //
  // BUG FIX (28 Jul, live report — "kenapa error?"): the string token '../../confirm' threw
  // NG04002 "Cannot match any routes" every time this was clicked — counting '../' hops by hand
  // across a lazy-loaded module boundary (HomeModule) doesn't reliably land where the comment
  // above (now corrected) assumed it would. Walking the ActivatedRoute OBJECT tree up to the
  // shell (this.route.parent = 'dashboard', .parent.parent = the shell's own '' route) and
  // resolving 'confirm' relative to THAT is unambiguous regardless of nesting/lazy boundaries.
  goToConfirmFrom(dinas: string, targetDinas?: string): void {
    const queryParams: Record<string, string> = { from: dinas };
    if (targetDinas) queryParams['target'] = targetDinas;
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], { relativeTo: shellRoute, queryParams });
  }

  // REQ-RDT-NAV-03: drill-down needs a real (initiator, target) PAIR. The personal view's cards
  // ARE exactly that (my own dinas -> d.dinas). TAB's global view (29 Jul restructure) is NOW
  // ALSO pair-shaped (dashboard.js's buildChainAwareProgress groupBy:'pair' — d.dinas is the
  // INITIATOR, d.target_dinas the target) instead of the old initiator-only aggregate that
  // deliberately blocked this click ("scope cut, not an oversight") — project owner asked TAB be
  // able to drill in from "Repost Every PIC" to see which target dinas per initiator is still
  // outstanding. 'detail/...' is a sibling of HomeComponent's own '' route within HomeModule (see
  // home.module.ts) — NOT '../detail': HomeComponent's own route consumes zero URL segments
  // (path ''), so Angular resolves siblings directly relative to it without an extra '../' hop
  // (verified empirically — '../detail' overshot past the 'dashboard' lazy-module mount entirely).
  goToDetail(d: DinasProgress): void {
    const myDinas = this.currentUser.current?.dinas;
    const initiator = this.isGlobalView ? d.dinas : myDinas;
    const target = this.isGlobalView ? d.target_dinas : d.dinas;
    if (!initiator || !target) return;
    this.router.navigate(['detail', initiator, target], { relativeTo: this.route });
  }

  // Item 5: 3-color progress ring. 100% = blue (done). Below 100% but at/above half = yellow
  // (still needs confirmation, but on track). Below half = red (needs attention).
  ringColor(percent: number): '#006298' | '#f2b400' | '#b3261e' {
    if (percent >= 100) return '#006298';
    if (percent < 50) return '#b3261e';
    return '#f2b400';
  }

  // REQ-RDT-NAV-02 (Figma 78:242/78:243, 1 Agu): 3-segment horizontal bar (Confirmed/Open/
  // Declined) replacing the donut ring on the 'own' sub-view's pair cards. "Confirmed" here means
  // `resolved` (CONFIRMED+BORNE_BY_INITIATOR combined, same definition `percent` already uses
  // elsewhere in the app) — Figma's mockup label doesn't distinguish BORNE_BY_INITIATOR out, and
  // introducing a second "confirmed" definition just for this bar would contradict the number
  // shown right next to it.
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

  // REQ-RDT-NAV-02 (Figma 78:243): status pill tone for the per-dinas rollup table.
  rollupStatusClass(row: PerDinasRollupRow): string {
    return row.status ? `rollup-status--${row.status.kind}` : '';
  }

  // P4.6 (3 Agu, Figma 78:242 re-pull): state_label pill is color-coded by status in the
  // reference design (amber "Waiting for confirmation X", blue "Waiting to repost", green
  // "Reposted..."/subdoc) — was a single flat gray tone before. Matched on the label TEXT
  // (see backend's stateLabel.js — it's a derived string, not a stored enum) rather than
  // duplicating deriveStateLabel's branching here.
  stateLabelClass(label: string): string {
    if (label.startsWith('Waiting for confirmation')) return 'pair-card__state-label--amber';
    if (label.startsWith('Waiting to repost')) return 'pair-card__state-label--blue';
    if (label.startsWith('Reposted')) return 'pair-card__state-label--green';
    return '';
  }
}
