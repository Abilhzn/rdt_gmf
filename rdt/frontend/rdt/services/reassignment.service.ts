import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface DeclinedRow {
  id: number;
  sheet_name?: string;
  raw_row_index?: number;
  account?: string;
  nominal: number;
  category?: string;
  remark?: string;
  ref_doc?: string;
  dinas_target: string;
  reassign_count: number;
}

// REQ-RDT-LEDGER-07 — see src/backend/src/routes/reassignment.js for the confirmed rules:
// BORNE_BY_INITIATOR is a status-only change (no ledger entries), REASSIGN overwrites the
// same row's dinas_target and is capped at 3 attempts.
@Injectable({ providedIn: 'root' })
export class ReassignmentService {
  private readonly base = '/api/declined';
  readonly REASSIGN_CAP = 3;

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getDeclined(dinas: string): Observable<DeclinedRow[]> {
    return this.http
      .get<{ ok: boolean; rows: DeclinedRow[]; error?: string }>(`${this.base}/${encodeURIComponent(dinas)}`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat data declined');
        return res.rows;
      }));
  }

  resolveBorne(id: number, note?: string): Observable<void> {
    return this.resolve(id, 'BORNE', undefined, note);
  }

  resolveReassign(id: number, newDinasTarget: string, note?: string): Observable<void> {
    return this.resolve(id, 'REASSIGN', newDinasTarget, note);
  }

  private resolve(id: number, action: 'BORNE' | 'REASSIGN', newDinasTarget?: string, note?: string): Observable<void> {
    const body: any = { action };
    if (newDinasTarget) body.new_dinas_target = newDinasTarget;
    if (note?.trim()) body.note = note.trim();
    return this.http
      .post<{ ok: boolean; error?: string }>(`${this.base}/${id}/resolve`, body, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'resolve failed');
      }));
  }

  // Item 10 "Confirm All" — resolve every item in one request/one DB transaction instead of
  // N independent HTTP calls, so a mid-batch failure can't leave some rows resolved and others
  // still DECLINED. See reassignment.js's batch-resolve for the atomicity note.
  resolveBatch(items: Array<{ id: number; action: 'BORNE' | 'REASSIGN'; new_dinas_target?: string }>, note?: string): Observable<number> {
    const body: any = { items };
    if (note?.trim()) body.note = note.trim();
    return this.http
      .post<{ ok: boolean; resolved_count: number; error?: string }>(`${this.base}/batch-resolve`, body, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'batch resolve failed');
        return res.resolved_count;
      }));
  }
}
