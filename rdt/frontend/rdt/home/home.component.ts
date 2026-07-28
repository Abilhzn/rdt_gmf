import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService, DinasProgress } from '../services/dashboard.service';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-NAV-02 — rebuilt to match the updated Figma (node 1:2, "Dashboard"): personalized
// two-panel view, not a global admin overview. Left = progress of MY OWN dinas's outgoing
// submissions per target dinas ("Dashboard Pengajuan [User]"). Right = which OTHER dinas
// have submissions waiting on me to confirm ("Need to Confirm") — clicking one navigates to
// Confirmation filtered to that initiator dinas.
@Component({
  selector: 'rdt-home',
  standalone: false,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  asInitiator: DinasProgress[] = [];
  needToConfirm: string[] = [];
  errorMessage = '';
  loaded = false;
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
    this.currentUser.user$.subscribe(() => this.load());
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

  goToConfirmFrom(dinas: string): void {
    // relative, not '/confirm' — HomeComponent sits two routing levels below ShellComponent
    // (dashboard's lazy module, then home's own ''), so '../../confirm' reaches its sibling
    // regardless of where the host platform mounts RdtModule (see LoginComponent's note).
    this.router.navigate(['../../confirm'], { relativeTo: this.route, queryParams: { from: dinas } });
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
