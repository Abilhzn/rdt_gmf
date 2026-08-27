import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService, DinasProgress, DashboardKpis, PerDinasRollupRow } from '../services/dashboard.service';
import { CurrentUserService } from '@auth/services/current-user.service';
import { extractErrorMessage } from '../../../shared/error-message.util';

// "Jalur Repost" (18 Agu) — pair-card's route strip. A "chip" is either a real dinas node or a
// collapsed "+N" gap (long chain, see routeChips()); a "segment" is the connecting line between
// two adjacent chips, always chips.length - 1 of them.
export interface RouteChip {
  kind: 'node' | 'gap';
  code?: string;
  hidden?: number;
  state?: 'settled' | 'current';
}
export interface RouteSegment {
  state: 'settled' | 'current';
  fillPct?: number;
}

// Two switchable Dashboard sub-views (not a side-by-side layout), "Need to Confirm" default since
// it's the action item. Sub-view lives in the `sub` query param (?sub=need|own) so it's
// linkable/shareable and ShellComponent's sidebar sub-links (a sibling, not an ancestor) can read
// it too — see ShellComponent.dashboardSubview.
@Component({
  selector: 'app-dashboard-page',
  standalone: false,
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
})
export class DashboardPageComponent implements OnInit {
  asInitiator: DinasProgress[] = [];
  needToConfirm: DinasProgress[] = [];
  errorMessage = '';
  loaded = false;
  subview: 'need' | 'own' = 'need';
  /** Role TAB sees a global view across every submitting dinas instead of their own outgoing
   * submissions — TAB doesn't originate reposts itself. */
  isGlobalView = false;

  // KPI summary row + (TAB only) the per-dinas rollup table — shown on the 'own' sub-view and
  // TAB's 'need' sub-view. A plain PIC's "Need to Confirm" keeps the donut-card look, no KPI row.
  kpis: DashboardKpis | null = null;
  perDinasRollup: PerDinasRollupRow[] = [];

  /** Which rollup row's per-pasangan breakdown is expanded, at most one at a time. null dinas +
   * empty rows means the panel is closed. */
  breakdownOpenDinas: string | null = null;
  breakdownRows: DinasProgress[] = [];
  breakdownLoading = false;
  breakdownError = '';

  /** Which card's chain-detail badge is expanded, at most one at a time — keyed by kind + the
   * pair's dinas codes, since 'need' and 'own' lists can both be on screen at once. */
  expandedChainKey: string | null = null;

  constructor(
    private dashboard: DashboardService,
    public currentUser: CurrentUserService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      // TAB's Dashboard defaults to 'own' (Summary Progress All Dinas) when no ?sub= is set;
      // a plain PIC defaults to 'need'. An explicit ?sub= always wins for either role.
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

  // Semua nilai finansial di GMF itu USD — simbol "$" + singkatan K/M/B, bukan Rp/jt/rb/M.
  formatCurrency(value: number | undefined | null): string {
    if (value == null || !isFinite(value)) return '$0';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1_000_000_000) return `$${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `$${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${sign}${(abs / 1_000).toFixed(1)}K`;
    return `$${sign}${Math.round(abs)}`;
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    if (!this.currentUser.current) {
      this.asInitiator = [];
      this.needToConfirm = [];
      this.kpis = null;
      this.perDinasRollup = [];
      this.breakdownOpenDinas = null;
      this.breakdownRows = [];
      return;
    }
    this.dashboard.getSummary().subscribe({
      next: (summary) => {
        this.asInitiator = summary.as_initiator;
        this.needToConfirm = summary.need_to_confirm;
        this.isGlobalView = summary.is_global_view;
        this.loaded = true;
      },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat dashboard'); },
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

  // Routing depends on whether the pair still has anything PENDING: still outstanding -> straight
  // to the action page (Confirm); fully resolved -> read-only Dashboard-Detailing. Only 'need'
  // cards go to Confirm — Confirm is the ACTION page for the CONFIRMING dinas (the target), and an
  // 'own' card's viewer is the INITIATOR, never authorized to act there (auth.js's
  // requireDinasAccess 403s them otherwise) — so 'own' cards always land on Dashboard-Detailing.
  onCardClick(kind: 'need' | 'own', d: DinasProgress): void {
    if (kind === 'need' && d.target_dinas === 'INVESTIGATION') {
      // Investigation/Ask TA pseudo-card goes straight to Confirmation's Investigation sub-tab —
      // it isn't a real (initiator, target) pair, so the pending/resolved split above doesn't apply.
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

  // Same pseudo-card sentinel appears on both panels — 'need' shape has it at target_dinas (dinas
  // = the real initiator), 'own' shape has it at dinas directly for the personal view (target_dinas
  // unset) or at target_dinas for TAB's pair-grouped global view.
  isInvestigationCard(d: DinasProgress): boolean {
    return d.dinas === 'INVESTIGATION' || d.target_dinas === 'INVESTIGATION';
  }

  // Centralizes every pair-card title so the Investigation sentinel never leaks its raw code into
  // the UI as a "dinas name" — reuses the same "Investigation/Ask TA" label the Confirmation
  // sub-nav uses. Both 'own' and 'need' cards carry a full redirect breadcrumb in d.chain (e.g.
  // ['TJ','TC','TL']) when every transaction under the card agrees on the same path — render that
  // instead of just the two endpoints when present.
  pairTitle(kind: 'need' | 'own', d: DinasProgress): string {
    const label = (code: string | undefined) => (code === 'INVESTIGATION' ? 'Investigation/Ask TA' : code);
    return this.pairChain(kind, d).map((c) => label(c)).join(' → ');
  }

  // Same real-vs-fallback chain logic as pairTitle() above, extracted so routeChips() below can
  // reuse it as an array instead of a joined string.
  pairChain(kind: 'need' | 'own', d: DinasProgress): string[] {
    if (d.chain?.length) return d.chain;
    if (kind === 'need') return [d.dinas, d.target_dinas || this.myDinas || ''];
    if (this.isGlobalView) return [d.dinas, d.target_dinas || ''];
    return [this.myDinas || '', d.dinas];
  }

  // Route strip chips: node codes to render, truncated to first+gap+current when the chain has
  // more than 3 members — caps the strip's width, same "+N hop lainnya" truncation idea
  // shared/chain-hop-detail.component.ts uses for the expanded list.
  routeChips(kind: 'need' | 'own', d: DinasProgress): RouteChip[] {
    const chain = this.pairChain(kind, d);
    const len = chain.length;
    if (len <= 3) {
      return chain.map((code, i) => ({ kind: 'node', code, state: this.routeNodeState(i, len) }));
    }
    return [
      { kind: 'node', code: chain[0], state: 'settled' },
      { kind: 'gap', hidden: len - 2 },
      { kind: 'node', code: chain[len - 1], state: 'current' },
    ];
  }

  // One fewer than routeChips() — a segment sits BETWEEN each pair of chips. Only the LAST segment
  // (leading into the current/last node) is "current" (filled proportional to d.percent) — every
  // earlier segment is a settled, already-happened redirect, solid rather than partial.
  routeSegments(kind: 'need' | 'own', d: DinasProgress): RouteSegment[] {
    const chips = this.routeChips(kind, d);
    return chips.slice(1).map((_, i) => {
      const isLast = i === chips.length - 2;
      return isLast ? { state: 'current', fillPct: d.percent } : { state: 'settled' };
    });
  }

  // Only a chain of exactly 2 (a direct pair, never redirected) has no settled hop at all — both
  // its endpoints belong to the one-and-only in-progress hop, so both read "current". Every other
  // chain has at least one genuinely settled hop before the current one; only its LAST node is
  // "current" (where the pasangan sits right now), everything earlier (including the node right
  // before the current hop) is settled.
  private routeNodeState(i: number, len: number): 'settled' | 'current' {
    if (i === len - 1) return 'current';
    if (i === 0 && len === 2) return 'current';
    return 'settled';
  }

  // Badge collapsed by default, click expands sideways. At most one card expanded at a time
  // (clicking a second one closes the first) — same convention as need-approval's expandedPairKey.
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

  // 'need' shape is ALREADY (dinas=initiator, target_dinas=target), same as 'own'+global (TAB's
  // pair-grouped global view). Personal 'own' cards (a plain PIC's own submissions) are the
  // opposite: dinas=target, this viewer's own dinas is the implicit initiator.
  private resolvePair(kind: 'need' | 'own', d: DinasProgress): { initiator: string; target: string } | null {
    const myDinas = this.currentUser.current?.dinas;
    const usesRowAsIs = kind === 'need' || this.isGlobalView;
    const initiator = usesRowAsIs ? d.dinas : myDinas;
    const target = usesRowAsIs ? d.target_dinas : d.dinas;
    if (!initiator || !target) return null;
    return { initiator, target };
  }

  // targetDinas: the REAL queue this pair sits under — without it, Confirmation always defaulted
  // to the viewer's own dinas, so TAB clicking a TA-targeted card landed on TAB's empty queue.
  // Uses the ActivatedRoute OBJECT tree (this.route.parent = 'dashboard', .parent.parent = the
  // shell's own '' route), not a string token like '../../confirm' — counting '../' hops by hand
  // across a lazy-loaded module boundary (HomeModule) throws NG04002 "Cannot match any routes".
  goToConfirmFrom(dinas: string, targetDinas: string): void {
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], { relativeTo: shellRoute, queryParams: { from: dinas, target: targetDinas } });
  }

  // Drill-down needs a real (initiator, target) PAIR (see resolvePair above). 'detail/...' is a
  // sibling of DashboardPageComponent's own '' route within HomeModule — NOT '../detail': DashboardPageComponent's
  // own route consumes zero URL segments (path ''), so siblings resolve directly relative to it.
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

  // 3-segment horizontal bar (Confirmed/Open/Declined) on the 'own'/TAB-'need' pair cards.
  // "Confirmed" here means `resolved` (CONFIRMED+BORNE_BY_INITIATOR combined), same definition
  // `percent` uses elsewhere — a second "confirmed" definition here would contradict that number.
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

  // "lihat detail" icon per rollup row — opens/closes the per-pasangan breakdown panel for that
  // ONE dinas_inisiasi. Re-clicking the open row's own icon just closes it (no re-fetch).
  toggleBreakdown(dinas: string): void {
    if (this.breakdownOpenDinas === dinas) {
      this.breakdownOpenDinas = null;
      this.breakdownRows = [];
      this.breakdownError = '';
      return;
    }
    this.breakdownOpenDinas = dinas;
    this.breakdownRows = [];
    this.breakdownError = '';
    this.breakdownLoading = true;
    this.dashboard.getBreakdown(dinas).subscribe({
      next: (rows) => { this.breakdownRows = rows; this.breakdownLoading = false; },
      error: (err) => { this.breakdownError = extractErrorMessage(err, 'Gagal memuat breakdown'); this.breakdownLoading = false; },
    });
  }

  // state_label pill is color-coded by status (amber "Waiting for confirmation X", blue "Waiting
  // to repost", green "Reposted..."/subdoc). Matched on the label TEXT (see backend's
  // stateLabel.js — it's a derived string, not a stored enum) rather than duplicating
  // deriveStateLabel's branching here.
  stateLabelClass(label: string): string {
    // The bar-left pill is now ALWAYS rendered, so this can be called with an empty/undefined label.
    if (!label) return '';
    if (label.startsWith('Waiting for confirmation')) return 'pair-card__state-label--amber';
    if (label.startsWith('Waiting to repost')) return 'pair-card__state-label--blue';
    if (label.startsWith('Reposted')) return 'pair-card__state-label--green';
    return '';
  }
}
