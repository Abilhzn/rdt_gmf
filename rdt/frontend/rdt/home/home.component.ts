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
    if (kind === 'need') this.goToConfirmFrom(d.dinas, d.target_dinas);
    else this.goToDetail(d.dinas);
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

  // REQ-RDT-NAV-03: drill-down only makes sense for a real (initiator, target) PAIR. The
  // personal view's cards ARE exactly that (my own dinas -> d.dinas), so they're clickable. The
  // TAB global view groups by INITIATOR only across every target — a card there doesn't
  // represent one pair, so it deliberately stays non-clickable (ground truth ui-demo.html's
  // renderDashOwn: "scope cut, not an oversight"). 'detail/...' is a sibling of HomeComponent's
  // own '' route within HomeModule (see home.module.ts) — NOT '../detail': HomeComponent's own
  // route consumes zero URL segments (path ''), so Angular resolves siblings directly relative
  // to it without an extra '../' hop (verified empirically — '../detail' overshot past the
  // 'dashboard' lazy-module mount entirely).
  goToDetail(targetDinas: string): void {
    if (this.isGlobalView) return;
    const myDinas = this.currentUser.current?.dinas;
    if (!myDinas) return;
    this.router.navigate(['detail', myDinas, targetDinas], { relativeTo: this.route });
  }

  // Item 5: 3-color progress ring. 100% = blue (done). Below 100% but at/above half = yellow
  // (still needs confirmation, but on track). Below half = red (needs attention).
  ringColor(percent: number): '#006298' | '#f2b400' | '#b3261e' {
    if (percent >= 100) return '#006298';
    if (percent < 50) return '#b3261e';
    return '#f2b400';
  }
}
