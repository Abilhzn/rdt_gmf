import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardDetailService, PairTransaction } from '../services/dashboard-detail.service';
import { DinasProgress } from '../services/dashboard.service';
import { Comment } from '../services/comment.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { MentionInputComponent } from '../shared/mention-input.component';

interface ThreadRow {
  comment: Comment;
  depth: number;
}

// REQ-RDT-NAV-03/REQ-RDT-COMMENT-01/02/03 — drill-down for one (initiator, target) dinas pair:
// progress circle for that pair specifically, plus a forum-style comment thread (parent/child
// replies, @mention autocomplete/notifications/linked render — see shared/mention-input.component
// .ts and shared/mention-text.component.ts, REQ-RDT-COMMENT-03 diperluas 3 Agu: one shared
// implementation, no longer this component's own copy). Ground truth ui-demo.html's
// view-dashboard-detail — reached only by clicking a Dashboard card (see HomeComponent), not a
// sidebar item, so it isn't in PAGE_TITLES/nav — nested under HomeModule's routes precisely so
// the "Dashboard" sidebar link + page title stay active/correct here too (see home.module.ts).
@Component({
  selector: 'rdt-dashboard-detail',
  standalone: false,
  templateUrl: './dashboard-detail.component.html',
  styleUrls: ['./dashboard-detail.component.scss'],
})
export class DashboardDetailComponent implements OnInit {
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

  @ViewChild(MentionInputComponent) commentInput?: MentionInputComponent;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private detailSvc: DashboardDetailService,
    public currentUser: CurrentUserService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const initiator = params.get('initiator');
      const target = params.get('target');
      if (!initiator || !target) return;
      this.initiatorDinas = initiator;
      this.targetDinas = target;
      this.clearReplyTarget();
      this.load();
    });
  }

  // REQ-RDT-LEDGER-10 (29 Jul): the 'INVESTIGATION' sentinel (see dashboard.js's
  // fetchInvestigationCounts) shouldn't leak its raw code into the UI — same label the
  // Confirmation sub-nav and Dashboard pair cards already use.
  get targetLabel(): string {
    return this.targetDinas === 'INVESTIGATION' ? 'Investigation/Ask TA' : this.targetDinas;
  }

  get replyCountLabel(): string {
    const total = this.progress?.total ?? 0;
    return `${this.threadRows.length} comment · ${total} transaksi`;
  }

  // REQ-RDT-NAV-03 (31 Jul, presentation feedback): render the FULL redirect path (e.g.
  // "TJ → TC → TL"), not just the two endpoints — backend already tracks the chain via
  // audit_log's REASSIGN/REJECT_REDIRECT history (see dashboard.js's buildChainAwareProgress),
  // this just renders it. Falls back to the plain [initiator, target] pair when the backend
  // didn't send a chain (no redirect happened, or the card blends multiple different paths).
  get breadcrumb(): string[] {
    if (this.progress?.chain?.length) return this.progress.chain;
    return [this.initiatorDinas, this.targetLabel];
  }

  // REQ-RDT-NAV-03 (3 Agu, re-flagged still-open): every transaction whose OWN chain has more
  // than the plain 2-point [initiator, target] — i.e. it was actually redirected at least once —
  // regardless of whether the header breadcrumb above could show a single representative chain
  // for the whole pair.
  get redirectedTransactions(): PairTransaction[] {
    return this.transactions.filter((t) => (t.chain?.length || 0) > 2);
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
      error: (err) => { this.errorMessage = err?.error?.error || err?.message || 'Gagal memuat detail'; },
    });
  }

  // Mirrors ui-demo.html's renderDdThread: builds a parent/child tree from the flat,
  // oldest-first comment list, then flattens it back into render order with a depth per row
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

  backToDashboard(): void {
    // Three '../' — relative '../' pops ONE URL SEGMENT at a time, not one routeConfig entry
    // (verified empirically): this route's path 'detail/:initiator/:target' consumes 3 segments
    // ('detail', the initiator param, the target param), so all 3 must be popped to land back on
    // HomeComponent's '' route ('/rdt/dashboard'). One or two '../' undershoots into an invalid,
    // partially-popped URL.
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
      error: (err) => {
        this.submitting = false;
        this.errorMessage = err?.error?.error || err?.message || 'Gagal mengirim komentar';
      },
    });
  }

  trackByCommentId(i: number, row: ThreadRow): number { return row.comment.id; }
}
