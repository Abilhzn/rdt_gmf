import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';
import { DinasProgress } from './dashboard.service';
import { Comment } from '../../../shared/models/comment.model';

export interface PairTransaction {
  id: number;
  account: string;
  nominal: number;
  status_konfirmasi: string;
  ref_doc: string | null;
  remark: string | null;
  dinas_target: string;
  reassign_count: number;
  /** This transaction's OWN full redirect path (initiator -> every dinas it was reassigned FROM
   * -> its current target) — independent of `progress.chain`, which only shows a value when
   * EVERY transaction in the whole pair agrees on the same path. This is what actually lets a 2+
   * hop reassignment be seen anywhere in the UI. Absent for the INVESTIGATION pseudo-pair
   * (dinas_target IS NULL, nothing to chain-resolve yet). */
  chain?: string[];
}

export interface DashboardDetail {
  initiatorDinas: string;
  targetDinas: string;
  progress: DinasProgress;
  transactions: PairTransaction[];
  comments: Comment[];
}

// Drill-down + comment thread for one (initiator, target) dinas pair, reached by clicking a card
// on the Dashboard — `dashboard/detail/:initiatorDinas/:targetDinas` (`dashboard.controller.ts`).
@Injectable({ providedIn: 'root' })
export class DashboardDetailService {
  private readonly base = `${API_BASE}/dashboard/detail`;

  constructor(private http: HttpClient) {}

  getDetail(initiatorDinas: string, targetDinas: string): Observable<DashboardDetail> {
    return this.http
      .get<{ initiator_dinas: string; target_dinas: string; progress: DinasProgress; transactions: PairTransaction[]; comments: Comment[] }>(
        `${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}`,
      )
      .pipe(map((res) => ({ initiatorDinas: res.initiator_dinas, targetDinas: res.target_dinas, progress: res.progress, transactions: res.transactions, comments: res.comments })));
  }

  // Lightweight comments-only fetch (Confirmation shows the pair's existing discussion, read-only,
  // above the transaction list — see features/confirmation/services/comment-thread.service.ts) —
  // no progress/transactions payload, unlike getDetail() above.
  getComments(initiatorDinas: string, targetDinas: string): Observable<Comment[]> {
    return this.http
      .get<{ comments: Comment[] }>(`${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}/comments`)
      .pipe(map((res) => res.comments));
  }

  postComment(initiatorDinas: string, targetDinas: string, body: string, parentCommentId?: number): Observable<Comment> {
    const payload: { body: string; parent_comment_id?: number } = { body };
    if (parentCommentId) payload.parent_comment_id = parentCommentId;
    return this.http
      .post<{ comment: Comment; notified: string[] }>(`${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}/comments`, payload)
      .pipe(map((res) => res.comment));
  }
}
