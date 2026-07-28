import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardDetailService } from '../services/dashboard-detail.service';
import { DinasProgress } from '../services/dashboard.service';
import { Comment } from '../services/comment.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { DinasService } from '../services/dinas.service';

interface MentionOption {
  /** what actually gets inserted after "@" — must stay a single \w-ish token, no spaces */
  token: string;
  /** what's shown in the dropdown so entries are distinguishable */
  label: string;
}

interface ThreadRow {
  comment: Comment;
  depth: number;
}

// REQ-RDT-NAV-03/REQ-RDT-COMMENT-01/02/03 — drill-down for one (initiator, target) dinas pair:
// progress circle for that pair specifically, plus a forum-style comment thread (parent/child
// replies, @mention autocomplete/notifications). Ground truth ui-demo.html's
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
  threadRows: ThreadRow[] = [];
  errorMessage = '';
  loaded = false;

  replyTo: Comment | null = null;
  commentBody = '';
  submitting = false;

  @ViewChild('commentInput') commentInput?: ElementRef<HTMLTextAreaElement>;
  mentionOptions: MentionOption[] = [];
  mentionSuggestions: MentionOption[] = [];
  showMentions = false;
  highlightedMentionIndex = -1;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private detailSvc: DashboardDetailService,
    public currentUser: CurrentUserService,
    dinasService: DinasService,
  ) {
    // Item 5 pattern reused from RepostBudgetingComponent — mentions cover every dinas AND user.
    dinasService.getActiveDinas().subscribe((dinasList) => {
      const dinasOptions: MentionOption[] = dinasList.map((d) => ({ token: d.code, label: `${d.code} — ${d.name}` }));
      this.mentionOptions = [...dinasOptions, ...this.mentionOptions.filter((o) => !dinasOptions.some((d) => d.token === o.token))];
    });
    this.currentUser.loadDirectory().subscribe((directory) => {
      const userOptions: MentionOption[] = Object.entries(directory).map(([id, entry]) => ({ token: id, label: `${entry.display_name} (${entry.dinas})` }));
      this.mentionOptions = [...this.mentionOptions, ...userOptions];
    });
  }

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

  get replyCountLabel(): string {
    const total = this.progress?.total ?? 0;
    return `${this.threadRows.length} reply · ${total} transaksi`;
  }

  load(): void {
    this.errorMessage = '';
    this.loaded = false;
    this.detailSvc.getDetail(this.initiatorDinas, this.targetDinas).subscribe({
      next: (detail) => {
        this.progress = detail.progress;
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
    setTimeout(() => this.commentInput?.nativeElement.focus());
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

  // ---------- @mention (same interaction as RepostBudgetingComponent) ----------
  // Bug fix (live testing, 24 Jul): capped at 8 like ui-demo.html originally was, but with 21
  // dinas + ~24 directory users to match against, 8 was too few to reliably find someone by
  // scanning alone — raised to 20 (the dropdown box already scrolls, .mention-list's
  // max-height/overflow-y in the scss). Also added arrow-key navigation + Enter-to-select,
  // which neither app had at all before — mouse-only wasn't enough for a list this size.
  onCommentInput(): void {
    const el = this.commentInput?.nativeElement;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const upToCursor = el.value.slice(0, cursor);
    const match = /@([\w-]*)$/.exec(upToCursor);
    if (!match) { this.showMentions = false; return; }
    const query = match[1].toLowerCase();
    this.mentionSuggestions = this.mentionOptions
      .filter((o) => o.token.toLowerCase().includes(query) || o.label.toLowerCase().includes(query))
      .slice(0, 20);
    this.showMentions = this.mentionSuggestions.length > 0;
    this.highlightedMentionIndex = this.showMentions ? 0 : -1;
  }

  onCommentKeydown(event: KeyboardEvent): void {
    if (!this.showMentions || !this.mentionSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedMentionIndex = (this.highlightedMentionIndex + 1) % this.mentionSuggestions.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedMentionIndex = (this.highlightedMentionIndex - 1 + this.mentionSuggestions.length) % this.mentionSuggestions.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = this.mentionSuggestions[this.highlightedMentionIndex];
      if (option) this.insertMention(option);
    } else if (event.key === 'Escape') {
      this.showMentions = false;
    }
  }

  insertMention(option: MentionOption): void {
    const el = this.commentInput?.nativeElement;
    if (!el) return;
    const cursor = el.selectionStart ?? this.commentBody.length;
    const upToCursor = this.commentBody.slice(0, cursor);
    const afterCursor = this.commentBody.slice(cursor);
    const replaced = upToCursor.replace(/@([\w-]*)$/, `@${option.token} `);
    this.commentBody = replaced + afterCursor;
    this.showMentions = false;
    const newCursor = replaced.length;
    setTimeout(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  }

  closeMentions(): void {
    setTimeout(() => { this.showMentions = false; }, 150);
  }

  trackByCommentId(i: number, row: ThreadRow): number { return row.comment.id; }
}
