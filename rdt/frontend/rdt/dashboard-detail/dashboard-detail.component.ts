import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardDetailService, PairTransaction } from '../services/dashboard-detail.service';
import { DinasProgress } from '../services/dashboard.service';
import { Comment } from '../services/comment.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { MentionInputComponent } from '../shared/mention-input.component';
import { extractErrorMessage } from '../shared/error-message.util';
import { ModalService } from '../services/modal.service';

interface ThreadRow {
  comment: Comment;
  depth: number;
}

// REQ-RDT-NAV-03/REQ-RDT-COMMENT-01/02/03 — drill-down for one (initiator, target) dinas pair:
// progress circle for that pair specifically, plus a forum-style comment thread (parent/child
// replies, @mention autocomplete/notifications/linked render — see shared/mention-input.component
// .ts and shared/mention-text.component.ts, REQ-RDT-COMMENT-03 diperluas 3 Agu: one shared
// implementation, no longer this component's own copy). This view is reached only by clicking
// a Dashboard card (see HomeComponent), not a sidebar item, so it isn't in PAGE_TITLES/nav —
// nested under HomeModule's routes precisely so
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

  /** REQ-RDT-UI-05 "Rincian per-hop" (4 Agu): whether the per-hop breakdown panel under the
   * header breadcrumb is open — resets whenever a different pair is loaded (see ngOnInit). */
  chainExpanded = false;

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
      this.load();
    });
  }

  // REQ-RDT-UI-05 "Rincian per-hop": only worth a badge when there's an actual multi-hop redirect
  // to break down — same >2 threshold as home.component's chain-badge, and as breadcrumb's own
  // "did the backend send a real chain, not just the 2-point fallback" check above.
  get hasChainDetail(): boolean {
    return (this.progress?.chain?.length || 0) > 2;
  }

  toggleChainExpand(): void {
    this.chainExpanded = !this.chainExpanded;
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

  // B2 (3 Agu): card clicks now land here first (see HomeComponent.onCardClick) instead of
  // jumping straight to Confirmation — this is the one-click path onward to actually act (the
  // checkbox+Submit flow), shown only while there's something PENDING on this pair to act on.
  // Same relative-routing hop HomeComponent's now-removed goToConfirmFrom used to do (this
  // component is ALSO nested inside HomeModule, per the class header comment, so the same
  // "count URL segments, not routeConfig entries" quirk applies here too).
  //
  // BUG FIX (5 Agu, live report — "403 di /rdt/confirm?from=TJ&target=TMM"): open>0 alone isn't
  // enough — this page is reachable by BOTH the initiator (viewing their own outgoing pair) and
  // the confirming dinas, but Confirm is the confirming dinas's ACTION page
  // (middleware/auth.js's requireDinasAccess 403s anyone else). An initiator clicking their own
  // pending pair here used to get a "Confirm Reposted" button that 403'd the moment they clicked
  // it — now the button itself only appears when the viewer is actually authorized to act:
  // role TAB, or their own dinas matches targetDinas (mirrors requireDinasAccess's own rule).
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
      // Mutating-action error pattern (see confirm.component.ts's resolveBorne/resolveReassign,
      // share-cost.component.ts's splitRow, repost-history.component.ts's addSubdoc): modal.alert,
      // not the inline `errorMessage` banner — that banner is reserved for load()'s GET failure
      // above. Was previously the load()-error pattern here by mistake (graphify trace, 12 Agu) —
      // easy to miss since the banner renders at the TOP of the page, far from the comment box at
      // the bottom, unlike the modal every other mutating call site here already uses.
      error: async (err) => {
        this.submitting = false;
        await this.modal.alert('Gagal mengirim komentar: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  trackByCommentId(i: number, row: ThreadRow): number { return row.comment.id; }
}
