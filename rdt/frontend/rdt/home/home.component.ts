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
  pairTitle(kind: 'need' | 'own', d: DinasProgress): string {
    const label = (code: string | undefined) => (code === 'INVESTIGATION' ? 'Investigation/Ask TA' : code);
    if (kind === 'need') return `${d.dinas} → ${label(d.target_dinas) || this.myDinas || ''}`;
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
}
