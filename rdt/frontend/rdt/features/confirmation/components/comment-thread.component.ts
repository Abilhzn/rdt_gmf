import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Comment } from '../../../shared/models/comment.model';

interface ThreadRow {
  comment: Comment;
  depth: number;
}

/** Dumb: read-only preview of a pair's discussion thread ("liatin dulu chatnya" before deciding
 * Ya/Tidak). Posting/reply stays on Dashboard-Detailing by design — this only links out
 * (`goToDetail`), it never posts itself. No HTTP — `comments` comes in as an `@Input`, flattened
 * from the parent/child tree into depth-annotated rows for a flat *ngFor.
 * Candidate for reuse by `features/dashboard/` (6d) once that lands its own thread rendering —
 * see Batch 6c's report for the consolidation note. */
@Component({
  selector: 'rdt-comment-thread',
  standalone: false,
  template: `
    <section class="card thread-card" *ngIf="fromDinas && toDinas">
      <h2>Diskusi {{ fromDinas }} → {{ toDinas }}</h2>
      <div>
        <div *ngFor="let row of threadRows" class="thread-comment" [style.marginLeft.px]="row.depth * 28">
          <div class="thread-comment__avatar"></div>
          <div class="thread-comment__body">
            <span class="thread-comment__name">{{ row.comment.author_display_name }}</span>
            <span class="thread-comment__meta">{{ row.comment.created_at | idDate }}</span>
            <p class="thread-comment__text"><rdt-mention-text [body]="row.comment.body"></rdt-mention-text></p>
          </div>
        </div>
      </div>
      <p class="note" *ngIf="loaded && !threadRows.length">Belum ada komentar pada pasangan dinas ini.</p>
      <div class="card__actions">
        <button class="btn btn--link" type="button" (click)="goToDetail.emit()">Lihat &amp; balas di Dashboard-Detailing →</button>
      </div>
    </section>
  `,
})
export class CommentThreadComponent {
  @Input() fromDinas: string | null = null;
  @Input() toDinas: string | null = null;
  @Input() loaded = false;
  @Output() goToDetail = new EventEmitter<void>();

  private _comments: Comment[] = [];
  @Input() set comments(value: Comment[] | null) {
    this._comments = value || [];
  }

  // Mirrors DashboardDetailComponent.buildThreadRows — flattens the parent/child comment tree into
  // depth-annotated rows for straightforward *ngFor rendering.
  get threadRows(): ThreadRow[] {
    const byParent = new Map<number | 'root', Comment[]>();
    for (const c of this._comments) {
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
}
