import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';
import { Comment } from '../../../shared/models/comment.model';

// Read-only fetch of a pair's discussion thread, for the preview above Confirmation's queue
// ("liatin dulu chatnya" before deciding Ya/Tidak — posting stays on Dashboard-Detailing, see
// comment-thread.component.ts). LOCAL to this feature rather than reusing the not-yet-migrated
// `services/dashboard-detail.service.ts` (still on the old `{ok,...}` response shape and 6d's own
// scope to port) — per Batch 6c's prompt, not blocking on 6d. Candidate for consolidation once 6d
// lands its own comment-thread component.
@Injectable({ providedIn: 'root' })
export class CommentThreadService {
  private readonly base = `${API_BASE}/dashboard/detail`;

  constructor(private http: HttpClient) {}

  getComments(initiatorDinas: string, targetDinas: string): Observable<Comment[]> {
    return this.http
      .get<{ comments: Comment[] }>(`${this.base}/${encodeURIComponent(initiatorDinas)}/${encodeURIComponent(targetDinas)}/comments`)
      .pipe(map((res) => res.comments));
  }
}
