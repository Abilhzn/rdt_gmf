import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';
import { DinasProgress } from './dashboard.service';
import { Comment } from './comment.model';

export interface PairTransaction {
  id: number;
  account: string;
  nominal: number;
  status_konfirmasi: string;
  ref_doc: string | null;
  remark: string | null;
  dinas_target: string;
  reassign_count: number;
}

export interface DashboardDetail {
  initiatorDinas: string;
  targetDinas: string;
  progress: DinasProgress;
  transactions: PairTransaction[];
  comments: Comment[];
}

// REQ-RDT-NAV-03/REQ-RDT-COMMENT — drill-down + comment thread for one (initiator, target) dinas
// pair, reached by clicking a card on the Dashboard (see routes/dashboard.js's
// /detail/:initiatorDinas/:targetDinas endpoints).
@Injectable({ providedIn: 'root' })
export class DashboardDetailService {
  private readonly base = '/api/dashboard/detail';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getDetail(initiatorDinas: string, targetDinas: string): Observable<DashboardDetail> {
    return this.http
      .get<{ ok: boolean; initiator_dinas: string; target_dinas: string; progress: DinasProgress; transactions: PairTransaction[]; comments: Comment[]; error?: string }>(
        `${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}`,
        { headers: this.currentUser.authHeaders() },
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat detail');
        return { initiatorDinas: res.initiator_dinas, targetDinas: res.target_dinas, progress: res.progress, transactions: res.transactions, comments: res.comments };
      }));
  }

  // Lightweight comments-only fetch (project owner request, 28 Jul: Confirmation shows the pair's
  // existing discussion, read-only, above the transaction list) — no progress/transactions
  // payload, unlike getDetail() above, since Confirmation already has its own pending rows.
  getComments(initiatorDinas: string, targetDinas: string): Observable<Comment[]> {
    return this.http
      .get<{ ok: boolean; comments: Comment[]; error?: string }>(
        `${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}/comments`,
        { headers: this.currentUser.authHeaders() },
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat diskusi');
        return res.comments;
      }));
  }

  postComment(initiatorDinas: string, targetDinas: string, body: string, parentCommentId?: number): Observable<Comment> {
    const payload: { body: string; parent_comment_id?: number } = { body };
    if (parentCommentId) payload.parent_comment_id = parentCommentId;
    return this.http
      .post<{ ok: boolean; comment: Comment; notified: string[]; error?: string }>(
        `${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}/comments`,
        payload,
        { headers: this.currentUser.authHeaders() },
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal mengirim komentar');
        return res.comment;
      }));
  }
}
