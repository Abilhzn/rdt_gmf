import { Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { NotificationsService } from '../services/notifications.service';
import { Notification } from '../services/notification.model';
import { DashboardService } from '../services/dashboard.service';
import { ExportBatchService } from '../services/export-batch.service';

// Display-label per route. 'repost'/'confirm'/'need-approval' are role-aware (lihat
// NavigationEnd handler di bawah), jadi tidak masuk sini.
const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  'share-cost': 'Share-Cost',
  'setting-periode': 'Setting Periode',
};

// Persistent sidebar wrapping <router-outlet>. "Guidance Application"/"Feedback Application"
// sengaja non-clickable — placeholder tanpa spec.
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

  needToConfirmCount = 0;
  dashboardSubview: 'need' | 'own' = 'need';

  // Reminder banner deadline periode berjalan, dari GET /current-reminder (satu-satunya route
  // non-TAB-gated di periodDeadlines.js). null = belum ada deadline default untuk periode ini.
  deadlineReminder: { periode: string; deadline_at: string } | null = null;
  // Sub-nav Confirmation TAB-only. 'TA' tidak masuk sini — TA punya PIC dan queue-nya sendiri,
  // bukan bagian dari queue tanpa-PIC milik TAB (itu cuma 'Corp').
  confirmSubTarget: 'Corp' | 'INVESTIGATION' = 'Corp';

  // Tree-view toggle per nav-group (Dashboard, Confirmation), independen satu sama lain — bukan
  // sidebar-width collapse (itu sudah dihapus total, sidebar sekarang fixed-width selalu).
  // Kosong = semua expanded by default; entry ditambah begitu user eksplisit collapse satu grup.
  private navGroupManuallyCollapsed = new Set<string>();
  // Grup yang lagi berisi halaman yang SEDANG dibuka user — di-set di NavigationEnd handler.
  // null kalau user lagi di halaman yang bukan bagian dari nav-group manapun (mis. Repost).
  private activeNavGroup: string | null = null;

  // Force-expanded kalau grup ini yang lagi aktif (gak boleh nyembunyiin halaman yang lagi
  // dibuka user, walau user pernah collapse manual grup ini sebelumnya) — ATAU kalau user belum
  // pernah collapse grup ini secara manual (default expanded).
  isNavGroupExpanded(key: string): boolean {
    return this.activeNavGroup === key || !this.navGroupManuallyCollapsed.has(key);
  }

  // Toggle HANYA grup yang diklik — sub-item grup lain (dan state expand/collapse-nya) sama
  // sekali gak kesentuh, sesuai "sub-item lain gak ikut kepengaruh, boleh banyak grup expand
  // bersamaan". Dipanggil dari tombol panah terpisah dari link navigasi itu sendiri (event.
  // stopPropagation di template) supaya klik panah gak ikut memicu navigasi.
  toggleNavGroup(key: string): void {
    if (this.navGroupManuallyCollapsed.has(key)) this.navGroupManuallyCollapsed.delete(key);
    else this.navGroupManuallyCollapsed.add(key);
  }

  constructor(
    public currentUser: CurrentUserService,
    private notificationsSvc: NotificationsService,
    private dashboardSvc: DashboardService,
    private exportBatches: ExportBatchService,
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
    // Reads the matched route CONFIG (routeConfig.path), not router.url string-split — the host
    // platform can mount this module under any prefix (dev-shell uses '/rdt').
    //
    // Run once eagerly here too: the very first NavigationEnd (select-platform -> dashboard)
    // fires before this subscription exists, so relying on the subscription alone misses the
    // initial route and leaves pageTitle/dashboardSubview/etc on stale defaults until the next click.
    this.syncFromRoute();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.syncFromRoute());
    this.loadNotifCount();
    this.loadDashboardBadge();
    this.loadDeadlineReminder();
  }

  // Loaded once at shell mount — single periode-wide value, tidak perlu re-fetch per navigasi.
  private loadDeadlineReminder(): void {
    if (!this.currentUser.current) { this.deadlineReminder = null; return; }
    this.exportBatches.getCurrentDeadlineReminder().subscribe({
      next: (res) => { this.deadlineReminder = res.deadline_at ? { periode: res.periode, deadline_at: res.deadline_at } : null; },
      error: () => { /* purely informational — ignore, same convention as notif/dashboard badge */ },
    });
  }

  private syncFromRoute(): void {
    const segment = this.route.firstChild?.snapshot.routeConfig?.path;
    // Nav-group (kalau ada) yang lagi dibuka user — dipakai isNavGroupExpanded() buat force-open.
    this.activeNavGroup = segment === 'dashboard' || segment === 'confirm' ? segment : null;
    const isTab = this.currentUser.current?.role === 'TAB';
    // Label per-role: TAB lihat title berbeda dari PIC biasa di beberapa halaman.
    if (segment === 'repost-history') {
      this.pageTitle = isTab ? 'Riwayat Repost TAB' : `Repost History ${this.currentUser.current?.dinas || ''}`;
    } else if (segment === 'repost') {
      this.pageTitle = 'Upload Detail Transaction';
    } else if (segment === 'confirm') {
      this.pageTitle = isTab ? 'Need Identification' : 'Detail Confirmation';
    } else if (segment === 'need-approval') {
      this.pageTitle = 'Wait to Repost';
    } else {
      this.pageTitle = (segment && PAGE_TITLES[segment]) || 'Dashboard';
    }
    // Dashboard sub-view aktif — HomeComponent owns ?sub=, sidebar (sibling, bukan ancestor)
    // baca ulang di sini biar bisa nge-bold link yang sesuai.
    if (segment === 'dashboard') {
      const sub = this.route.firstChild?.firstChild?.snapshot.queryParamMap.get('sub');
      this.dashboardSubview = sub === 'need' ? 'need' : sub === 'own' ? 'own' : isTab ? 'own' : 'need';
      this.loadDashboardBadge();
    } else if (segment === 'confirm') {
      const target = this.route.firstChild?.firstChild?.snapshot.queryParamMap.get('target');
      this.confirmSubTarget = target === 'INVESTIGATION' ? target : 'Corp';
    }
  }

  // Lightweight count-only call (bukan getSummary()'s full aggregation).
  private loadDashboardBadge(): void {
    if (!this.currentUser.current) { this.needToConfirmCount = 0; return; }
    this.dashboardSvc.getNeedToConfirmCount().subscribe({
      next: (count) => { this.needToConfirmCount = count; },
      error: () => { /* purely informational — ignore */ },
    });
  }

  // TAB tidak originate repost sendiri.
  get canSeeRepost(): boolean {
    return this.currentUser.current?.role !== 'TAB';
  }

  // TAB-only — role TAB satu-satunya yang approve submission (SM_TA/GH_TA sudah dihapus).
  get canSeeNeedApproval(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // UI-level gate saja — backend's requireRole('TAB') on /api/investigation yang enforce beneran.
  get canSeeConfirmSubnav(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  get canSeeSettingPeriode(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  // ---------- notifications ----------
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

  // Klik notifikasi -> langsung ke thread Dashboard-Detailing pasangan dinas terkait.
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
      this.router.navigate(['login'], { relativeTo: this.route });
    });
  }
}
