import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService, DinasProgress } from '../services/dashboard.service';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-NAV-02/02a — rebuilt to match the updated Figma (nodes 1:2 "Need to Confirm" / 69:209
// "Own Repost"): two switchable sub-views (not a side-by-side two-panel layout), "Need to
// Confirm" default since it's the action item (Own Repost is pure monitoring). Sub-view lives in
// the `sub` query param (?sub=need|own) so it's linkable/shareable and ShellComponent's sidebar
// sub-links (a sibling, not an ancestor of this component) can read it too — see
// ShellComponent.dashboardSubview.
//
// REQ-RDT-UI-05 (4 Agu, project owner rollback request): the KPI-card/segmented-bar restyle
// pulled from Figma 78:242/78:243 (and its later re-pull) is reverted — this file and its
// template/styles are back to the donut-ring pair-card design from before that reference (see
// git commit ce06ff2, the last commit before the restyle landed). Two real bug fixes landed in
// this file AFTER the restyle and are intentionally NOT reverted along with the visual design
// (explicit project owner call, since neither touches layout/styling): the A5 chain-arrow fix in
// pairTitle() below, and the B2 card-click-routing groundwork in resolvePair()/goToDetail() below
// — B2's own "always Dashboard-Detailing" behavior itself is superseded by REQ-RDT-NAV-03 revisi
// (4 Agu), see onCardClick() below.
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
      this.subview = params.get('sub') === 'own' ? 'own' : 'need';
    });
    this.currentUser.user$.subscribe(() => this.load());
  }

  get myDinas(): string | undefined {
    return this.currentUser.current?.dinas;
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    if (!this.currentUser.current) { this.asInitiator = []; this.needToConfirm = []; return; }
    this.dashboard.getSummary().subscribe({
      next: (summary) => {
        this.asInitiator = summary.as_initiator;
        this.needToConfirm = summary.need_to_confirm;
        this.isGlobalView = summary.is_global_view;
        this.loaded = true;
      },
      error: (err) => { this.errorMessage = err?.error?.error || err?.message || 'Gagal memuat dashboard'; },
    });
  }

  // REQ-RDT-NAV-03 REVISI (4 Agu, supersedes B2 from 3 Agu): NOT always Dashboard-Detailing
  // anymore — routing now depends on whether the pair still has anything PENDING. Still
  // outstanding -> straight to the action page (Confirm). Fully resolved -> the read-only
  // summary/history page (Dashboard-Detailing). B2's original motivation (a 'need' card used to
  // lose the rich status view — chain breadcrumb, full thread — that 'own'/Dashboard-Detailing
  // had) still holds for the RESOLVED case, which is exactly when this now lands there.
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
    if ((d.open || 0) > 0) {
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

  // Every hop in d.chain except the LAST is trivially "every transaction under this card moved
  // past it" (100%) — d.chain is only ever populated with more than 2 points when EVERY
  // transaction in the card agrees on the exact same full path (dashboard.js's
  // buildChainAwareProgress chainConsistent check), so chain-membership alone already proves
  // every one of them traversed and left each intermediate dinas. The LAST hop (current target)
  // is the only one with a real in-progress fraction, and that's exactly d.resolved/d.total —
  // the same numbers already driving the card's own percent ring, not a separate computation.
  chainHops(d: DinasProgress): { from: string; to: string; resolved: number; total: number }[] {
    if (!d.chain || d.chain.length < 3) return [];
    const total = d.total || 0;
    const hops: { from: string; to: string; resolved: number; total: number }[] = [];
    for (let i = 0; i < d.chain.length - 1; i++) {
      const isLast = i === d.chain.length - 2;
      hops.push({ from: d.chain[i], to: d.chain[i + 1], resolved: isLast ? (d.resolved || 0) : total, total });
    }
    return hops;
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
}
