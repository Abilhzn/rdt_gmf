import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardDetailService, PairTransaction } from '../services/dashboard-detail.service';
import { DinasProgress } from '../services/dashboard.service';
import { Comment } from '../../../shared/models/comment.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { MentionInputComponent } from '../../../shared/mention-input.component';
import { extractErrorMessage } from '../../../shared/error-message.util';
import { ModalService } from '../../../services/modal.service';
import { matchesAllColumnFilters } from '../../../shared/multi-value-filter.component';

interface ThreadRow {
  comment: Comment;
  depth: number;
}

// Drill-down for one (initiator, target) dinas pair: progress circle for that pair, plus a
// forum-style comment thread (parent/child replies, @mention autocomplete/notifications/linked
// render — see shared/mention-input.component.ts and shared/mention-text.component.ts). Reached
// only by clicking a Dashboard card (see HomeComponent), not a sidebar item, so it isn't in
// PAGE_TITLES/nav — nested under HomeModule's routes so the "Dashboard" sidebar link + page title
// stay active/correct here too (see home.module.ts).
@Component({
  selector: 'app-dashboard-detail-page',
  standalone: false,
  templateUrl: './dashboard-detail-page.component.html',
  styleUrls: ['./dashboard-detail-page.component.scss'],
})
export class DashboardDetailPageComponent implements OnInit {
  initiatorDinas = '';
  targetDinas = '';
  progress: DinasProgress | null = null;
  transactions: PairTransaction[] = [];
  threadRows: ThreadRow[] = [];
  errorMessage = '';
  loaded = false;

  replyTo: Comment | null = null;
  commentBody = '';
  submitting = false;

  /** Whether the per-hop breakdown panel under the header breadcrumb is open — resets whenever a
   * different pair is loaded (see ngOnInit). */
  chainExpanded = false;

  // Per-column multi-value filter for "Transaksi yang pernah di-redirect" — same
  // rdt-multi-value-filter + matchesAllColumnFilters every other DT table in the app uses.
  columnFilters: Record<string, string[]> = {};

  onColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.columnFilters[key] = values;
    else delete this.columnFilters[key];
  }

  // 'chain' isn't a plain scalar field on PairTransaction — filter against the same joined
  // string the template renders ("TJ → TC → TL"), so pasting that text (or a dinas code within
  // it) matches the way a user would actually expect after reading the rendered column.
  getRedirectCellValue(row: PairTransaction, key: string): string | number | null | undefined {
    if (key === 'chain') return (row.chain || []).join(' → ');
    return (row as unknown as Record<string, string | number | null | undefined>)[key];
  }

  @ViewChild(MentionInputComponent) commentInput?: MentionInputComponent;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private detailSvc: DashboardDetailService,
    public currentUser: CurrentUserService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const initiator = params.get('initiator');
      const target = params.get('target');
      if (!initiator || !target) return;
      this.initiatorDinas = initiator;
      this.targetDinas = target;
      this.clearReplyTarget();
      this.chainExpanded = false;
      this.columnFilters = {};
      this.load();
    });
  }

  // Only worth a badge when there's an actual multi-hop redirect to break down — same >2 threshold
  // as home.component's chain-badge.
  get hasChainDetail(): boolean {
    return (this.progress?.chain?.length || 0) > 2;
  }

  toggleChainExpand(): void {
    this.chainExpanded = !this.chainExpanded;
  }

  // The 'INVESTIGATION' sentinel shouldn't leak its raw code into the UI — same label the
  // Confirmation sub-nav and Dashboard pair cards use.
  get targetLabel(): string {
    return this.targetDinas === 'INVESTIGATION' ? 'Investigation/Ask TA' : this.targetDinas;
  }

  get replyCountLabel(): string {
    const total = this.progress?.total ?? 0;
    return `${this.threadRows.length} comment · ${total} transaksi`;
  }

  // Renders the FULL redirect path (e.g. "TJ → TC → TL"), not just the two endpoints — backend
  // tracks the chain via audit_log's REASSIGN/REJECT_REDIRECT history. Falls back to the plain
  // [initiator, target] pair when the backend didn't send a chain.
  get breadcrumb(): string[] {
    if (this.progress?.chain?.length) return this.progress.chain;
    return [this.initiatorDinas, this.targetLabel];
  }

  // Every transaction whose OWN chain has more than the plain 2-point [initiator, target] — i.e.
  // it was actually redirected at least once — regardless of what the header breadcrumb shows.
  get redirectedTransactions(): PairTransaction[] {
    return this.transactions.filter((t) => (t.chain?.length || 0) > 2);
  }

  get filteredRedirectedTransactions(): PairTransaction[] {
    return this.redirectedTransactions.filter((t) =>
      matchesAllColumnFilters(t, this.columnFilters, (row, key) => this.getRedirectCellValue(row, key)));
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    this.detailSvc.getDetail(this.initiatorDinas, this.targetDinas).subscribe({
      next: (detail) => {
        this.progress = detail.progress;
        this.transactions = detail.transactions;
        this.threadRows = this.buildThreadRows(detail.comments);
        this.loaded = true;
      },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat detail'); },
    });
  }

  // Builds a parent/child tree from the flat, oldest-first comment list, then flattens it
  // back into render order with a depth per row
  // (Angular templates don't recurse as naturally as string-building, so depth-annotated rows
  // work better than a nested structure here).
  private buildThreadRows(comments: Comment[]): ThreadRow[] {
    const byParent = new Map<number | 'root', Comment[]>();
    for (const c of comments) {
      const key = c.parent_comment_id ?? 'root';
      const list = byParent.get(key) || [];
      list.push(c);
      byParent.set(key, list);
    }
    const rows: ThreadRow[] = [];
    const walk = (parentKey: number | 'root', depth: number) => {
      for (const c of byParent.get(parentKey) || []) {
        rows.push({ comment: c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk('root', 0);
    return rows;
  }

  ringColor(percent: number): '#006298' | '#f2b400' | '#b3261e' {
    if (percent >= 100) return '#006298';
    if (percent < 50) return '#b3261e';
    return '#f2b400';
  }

  // One-click path onward to actually act (the checkbox+Submit flow on Confirm), shown only while
  // there's something PENDING. open>0 alone isn't enough: this page is reachable by BOTH the
  // initiator (viewing their own outgoing pair) and the confirming dinas, but Confirm is the
  // confirming dinas's ACTION page (auth.js's requireDinasAccess 403s anyone else) — so the button
  // only appears when the viewer is actually authorized: role TAB, or their own dinas matches
  // targetDinas (mirrors requireDinasAccess's own rule).
  get canGoToConfirm(): boolean {
    if (!this.progress || this.progress.open <= 0) return false;
    const user = this.currentUser.current;
    if (!user) return false;
    if (user.role === 'TAB') return true;
    return String(user.dinas).toUpperCase() === this.targetDinas.toUpperCase();
  }

  goToConfirm(): void {
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['confirm'], {
      relativeTo: shellRoute,
      queryParams: { from: this.initiatorDinas, target: this.targetDinas },
    });
  }

  backToDashboard(): void {
    // Three '../' — relative '../' pops ONE URL SEGMENT at a time, not one routeConfig entry: this
    // route's path 'detail/:initiator/:target' consumes 3 segments, so all 3 must be popped to
    // land back on HomeComponent's '' route ('/rdt/dashboard').
    this.router.navigate(['../../../'], { relativeTo: this.route });
  }

  setReplyTarget(comment: Comment): void {
    this.replyTo = comment;
    setTimeout(() => this.commentInput?.focus());
  }

  clearReplyTarget(): void {
    this.replyTo = null;
  }

  submitComment(): void {
    const body = this.commentBody.trim();
    if (!body) return;
    this.submitting = true;
    this.detailSvc.postComment(this.initiatorDinas, this.targetDinas, body, this.replyTo?.id).subscribe({
      next: () => {
        this.submitting = false;
        this.commentBody = '';
        this.clearReplyTarget();
        this.load();
      },
      // Mutating-action error pattern (see confirm.component.ts's resolveBorne/resolveReassign):
      // modal.alert, not the inline `errorMessage` banner — that banner is reserved for load()'s
      // GET failure above, and is easy to miss from the comment box at the bottom of the page.
      error: async (err) => {
        this.submitting = false;
        await this.modal.alert('Gagal mengirim komentar: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  trackByCommentId(i: number, row: ThreadRow): number { return row.comment.id; }
}
