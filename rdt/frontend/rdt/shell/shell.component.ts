import { Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { NotificationsService } from '../services/notifications.service';
import { Notification } from '../services/notification.model';
import { DashboardService } from '../services/dashboard.service';

// REQ-RDT-NAV-10 (31 Jul, presentation feedback): display-label renames. Only the UNAMBIGUOUS
// rows from the SRS table are applied here — two rows are explicitly flagged "perlu diklarifikasi,
// jangan ditebak" (whether the TAB dashboard's "Need to Confirm" sub-view and the TAB Confirmation
// nav item both become "Need Identification", risking two different nav items with the same
// name) and are deliberately left UNCHANGED pending the project owner's answer.
const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  // 'repost'/'confirm'/'need-approval' are role-aware now (see the NavigationEnd handler below) —
  // no longer static lookups.
  // SRS 3.10 (Share-Cost, 3 Agu): TAB-only page, lives under the "Need Identification" sub-nav
  // (see shell.component.html) — fixed title, no PIC-facing variant exists.
  'share-cost': 'Share-Cost',
  // REQ-RDT-SAP-14 (11 Agu): split out of Riwayat Repost TAB into its own TAB-only sidebar item.
  'setting-periode': 'Setting Periode',
};

// REQ-RDT-NAV-01 — persistent sidebar (logo + Dashboard/Repost/Confirmation/Need Approval)
// wrapping <router-outlet>. "Guidance Application"/"Feedback Application" are inert placeholders in the
// updated Figma (plain non-clickable divs there too) — no spec/annotation exists for them,
// so they're rendered disabled rather than routed anywhere invented.
@Component({
  selector: 'rdt-shell',
  standalone: false,
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent implements OnInit {
  pageTitle = 'Dashboard';

  showUserMenu = false;
  showNotifMenu = false;
  unreadCount = 0;
  notifications: Notification[] = [];

  // REQ-RDT-NAV-02a: sidebar badge count + which Dashboard sub-link is active — 0/'need' until
  // the first fetch resolves (ngOnInit) or until the user is on some other page (undefined stays
  // 'need' as a harmless default, matching HomeComponent's own default).
  needToConfirmCount = 0;
  dashboardSubview: 'need' | 'own' = 'need';
  // REQ-RDT-LEDGER-10 restructure (29 Jul): Confirmation's TAB-only sub-nav. Originally
  // TA/Corp/Investigation; REQ-RDT-AUTH-05 (corrected 31 Jul) removed 'TA' from this sub-nav —
  // TA has its own dedicated PIC and its own confirmation queue like any other dinas now, it is
  // NOT one of TAB's staffed no-PIC queues (that's just 'Corp'). Defaults to 'Corp'.
  confirmSubTarget: 'Corp' | 'INVESTIGATION' = 'Corp';

  constructor(
    public currentUser: CurrentUserService,
    private notificationsSvc: NotificationsService,
    private dashboardSvc: DashboardService,
    private router: Router,
    private route: ActivatedRoute,
    private elementRef: ElementRef<HTMLElement>,
  ) {}

  // Closes both dropdowns on any click outside their .user-menu-wrap.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showUserMenu && !this.showNotifMenu) return;
    const target = event.target as Node;
    const wraps = this.elementRef.nativeElement.querySelectorAll('.user-menu-wrap');
    for (const wrap of Array.from(wraps)) {
      if (wrap.contains(target)) return;
    }
    this.showUserMenu = false;
    this.showNotifMenu = false;
  }

  ngOnInit(): void {
    // Reads the matched route CONFIG (this.route.firstChild.routeConfig.path — e.g. 'repost'),
    // not this.router.url string-split — the latter assumed RdtModule sits at the app root, so
    // it broke (silently fell back to "Dashboard") as soon as the host platform mounts it under
    // any prefix (dev-shell mounts it at '/rdt', see LoginComponent's note on this same class of
    // bug elsewhere).
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      const segment = this.route.firstChild?.snapshot.routeConfig?.path;
      // REQ-RDT-SAP-12 (31 Jul, expanded): this page is TAB's own archive OR a dinas's own
      // archive of the same underlying data, so its title follows who's looking — same dynamic
      // pattern as Dashboard's "Repost Every PIC" vs "Own Repost" sub-link just below.
      const isTab = this.currentUser.current?.role === 'TAB';
      // REQ-RDT-NAV-10: "Riwayat Repost (dinas)" -> "Repost History" (general table) — TAB's own
      // page keeps its existing "Riwayat Repost TAB" label, not covered by that rename row.
      if (segment === 'repost-history') {
        this.pageTitle = isTab ? 'Riwayat Repost TAB' : `Repost History ${this.currentUser.current?.dinas || ''}`;
      } else if (segment === 'repost') {
        // "Repost (nav item)" -> "Upload Detail Transaction" (general table). TAB never reaches
        // this route at all now — see canSeeRepost below — but keep a harmless fallback.
        this.pageTitle = 'Upload Detail Transaction';
      } else if (segment === 'confirm') {
        // "Confirmation (nav item)" -> "Detail Confirmation" for a plain PIC; TERJAWAB 1 Agu for
        // TAB -> "Need Identification" (also absorbs the Dashboard "Need to Confirm" sub-view —
        // see dashboardSubview handling below).
        this.pageTitle = isTab ? 'Need Identification' : 'Detail Confirmation';
      } else if (segment === 'need-approval') {
        // "Need Approval" -> "Wait to Repost" (TAB-only table; this route is TAB-only already).
        this.pageTitle = 'Wait to Repost';
      } else {
        this.pageTitle = (segment && PAGE_TITLES[segment]) || 'Dashboard';
      }
      // REQ-RDT-NAV-02a: which Dashboard sub-link reads bold — HomeComponent owns the ?sub=
      // query param, read here too so the sidebar (a sibling, not an ancestor of HomeComponent)
      // can reflect it. Also a natural opportunistic refresh point for the badge count, refreshed
      // on every Dashboard load.
      if (segment === 'dashboard') {
        const sub = this.route.firstChild?.firstChild?.snapshot.queryParamMap.get('sub');
        // REQ-RDT-NAV-10 (1 Agu sore, reversed): TAB's "Need Identification" Dashboard sub-view
        // is back (see home.component.ts's isTabRole) — an explicit ?sub= always wins; with none,
        // TAB still defaults to 'own' (Summary Progress All Dinas). Unchanged for a plain PIC.
        this.dashboardSubview = sub === 'need' ? 'need' : sub === 'own' ? 'own' : isTab ? 'own' : 'need';
        this.loadDashboardBadge();
      } else if (segment === 'confirm') {
        const target = this.route.firstChild?.firstChild?.snapshot.queryParamMap.get('target');
        this.confirmSubTarget = target === 'INVESTIGATION' ? target : 'Corp';
      }
    });
    this.loadNotifCount();
    this.loadDashboardBadge();
  }

  // REQ-RDT-NAV-02a: lightweight count-only call (not getSummary()'s full aggregation) —
  // guaranteed call is ngOnInit (shell mount = login), refreshed opportunistically above.
  private loadDashboardBadge(): void {
    if (!this.currentUser.current) { this.needToConfirmCount = 0; return; }
    this.dashboardSvc.getNeedToConfirmCount().subscribe({
      next: (count) => { this.needToConfirmCount = count; },
      error: () => { /* purely informational — ignore */ },
    });
  }

  // REQ-RDT-NAV-10 (31 Jul): "Repost (nav item, versi TAB) -> Dihapus — TAB tidak originate
  // repost sendiri" — Repost used to have no role gate at all (every remaining role, PIC/TAB, was
  // allowed); now hidden specifically for TAB, unchanged for PIC.
  get canSeeRepost(): boolean {
    return this.currentUser.current?.role !== 'TAB';
  }

  // Need Approval is TAB-only (project owner correction, 24 Jul 2026 — SM_TA/GH_TA roles
  // removed entirely, role TAB alone now approves every submission once 100% confirmed,
  // including Corp's).
  get canSeeNeedApproval(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // REQ-RDT-LEDGER-10 restructure (29 Jul): Corp/Investigation sub-nav under Confirmation is
  // TAB-only, same gate Need Approval already used — a plain PIC only ever has their own single
  // queue, no sub-nav needed (backend's requireRole('TAB') on /api/investigation is the real
  // enforcement either way, this is just UI-level nav visibility).
  get canSeeConfirmSubnav(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // REQ-RDT-SAP-14 (11 Agu, user request: "taruh di sidebar-nya TAB") — moved out of the Riwayat
  // Repost TAB <details> panel into its own nav item, same TAB-only gate it already had there.
  get canSeeSettingPeriode(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // ---------- notifications (REQ-RDT-COMMENT-03) ----------
  private loadNotifCount(): void {
    this.notificationsSvc.list().subscribe({
      next: (res) => { this.unreadCount = res.unreadCount; },
      error: () => { /* purely informational — ignore */ },
    });
  }

  toggleUserMenu(): void {
    this.showUserMenu = !this.showUserMenu;
    if (this.showUserMenu) this.showNotifMenu = false;
  }

  toggleNotifMenu(): void {
    const opening = !this.showNotifMenu;
    this.showNotifMenu = opening;
    if (opening) this.showUserMenu = false;
    if (!opening) return;
    this.notificationsSvc.list().subscribe({
      next: (res) => {
        this.notifications = res.notifications;
        if (res.unreadCount > 0) {
          this.notificationsSvc.markRead().subscribe(() => { this.unreadCount = 0; });
        }
      },
      error: () => { /* purely informational — ignore */ },
    });
  }

  // Clicking a notification jumps straight to
  // its dinas pair's Dashboard-Detailing thread. 'dashboard' is a DIRECT CHILD of ShellComponent
  // here (see rdt-routing.module.ts), so no '../' — 'detail/...' is then nested further inside
  // HomeModule's own routes (see home.module.ts).
  goToNotifDetail(n: Notification): void {
    this.showNotifMenu = false;
    this.router.navigate(['dashboard', 'detail', n.dinas_inisiasi, n.dinas_target], { relativeTo: this.route });
  }

  doLogout(): void {
    this.currentUser.logout().subscribe(() => {
      this.showUserMenu = false;
      this.showNotifMenu = false;
      this.unreadCount = 0;
      this.notifications = [];
      // 'login', not '../login' or '/login' — ShellComponent's own route is path '' (0 URL
      // segments, same as HomeComponent's, see its goToDetail note on this exact quirk), so
      // it resolves siblings directly with no '../' hop. Mirrors goToNotifDetail just above,
      // which already gets this right by not using '../' either.
      this.router.navigate(['login'], { relativeTo: this.route });
    });
  }
}
