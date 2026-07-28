import { Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { NotificationsService } from '../services/notifications.service';
import { Notification } from '../services/notification.model';
import { DashboardService } from '../services/dashboard.service';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  repost: 'Repost',
  confirm: 'Confirmation',
  'need-approval': 'Need Approval',
};

// REQ-RDT-NAV-01 — persistent sidebar (logo + Dashboard/Repost/Confirmation/Need Approval)
// wrapping <router-outlet>, the Angular-side equivalent of ui-demo.html's hash-based view
// switching. "Guidance Application"/"Feedback Application" are inert placeholders in the
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

  constructor(
    public currentUser: CurrentUserService,
    private notificationsSvc: NotificationsService,
    private dashboardSvc: DashboardService,
    private router: Router,
    private route: ActivatedRoute,
    private elementRef: ElementRef<HTMLElement>,
  ) {}

  // Ground truth ui-demo.html closes both dropdowns on any click outside their .user-menu-wrap.
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
      this.pageTitle = (segment && PAGE_TITLES[segment]) || 'Dashboard';
      // REQ-RDT-NAV-02a: which Dashboard sub-link reads bold — HomeComponent owns the ?sub=
      // query param, read here too so the sidebar (a sibling, not an ancestor of HomeComponent)
      // can reflect it. Also a natural opportunistic refresh point for the badge count, same
      // idea as ui-demo.html's loadDashboard() re-rendering it on every Dashboard load.
      if (segment === 'dashboard') {
        const sub = this.route.firstChild?.firstChild?.snapshot.queryParamMap.get('sub');
        this.dashboardSubview = sub === 'own' ? 'own' : 'need';
        this.loadDashboardBadge();
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

  // Need Approval is TAB-only (project owner correction, 24 Jul 2026 — SM_TA/GH_TA roles
  // removed entirely, role TAB alone now approves every submission once 100% confirmed,
  // including Corp's). Repost has no role gate at all now — every remaining role (PIC, TAB)
  // was already allowed.
  get canSeeNeedApproval(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // ---------- notifications (REQ-RDT-COMMENT-03), ground truth ui-demo.html's loadNotifCount/
  // toggleNotifMenu ----------
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

  // Ground truth ui-demo.html's renderNotifList: clicking a notification jumps straight to
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
