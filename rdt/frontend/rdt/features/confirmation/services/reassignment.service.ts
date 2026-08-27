import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../../../core/api-config';

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

// `repost/reassignment` — BORNE_BY_INITIATOR is a status-only change (no ledger entries), REASSIGN
// overwrites the same row's dinas_target and is capped at 3 attempts (REASSIGN_CAP, enforced
// server-side, mirrored client-side in the UI below).
@Injectable({ providedIn: 'root' })
export class ReassignmentService {
  private readonly base = `${API_BASE}/repost/reassignment`;
  readonly REASSIGN_CAP = 3;

  constructor(private http: HttpClient) {}

  getDeclined(dinas: string): Observable<DeclinedRow[]> {
    return this.http.get<DeclinedRow[]>(`${this.base}/${encodeURIComponent(dinas)}`);
  }

  resolveBorne(id: number, note?: string): Observable<void> {
    return this.resolve(id, 'BORNE', undefined, note);
  }

  resolveReassign(id: number, newDinasTarget: string, note?: string): Observable<void> {
    return this.resolve(id, 'REASSIGN', newDinasTarget, note);
  }

  private resolve(id: number, action: 'BORNE' | 'REASSIGN', newDinasTarget?: string, note?: string): Observable<void> {
    const body: Record<string, string> = { action };
    if (newDinasTarget) body['new_dinas_target'] = newDinasTarget;
    if (note?.trim()) body['note'] = note.trim();
    return this.http.post<void>(`${this.base}/${id}/resolve`, body);
  }

  // "Confirm All" — resolve every item in one request/one DB transaction instead of N independent
  // HTTP calls, so a mid-batch failure can't leave some rows resolved and others still DECLINED.
  resolveBatch(items: { id: number; action: 'BORNE' | 'REASSIGN'; new_dinas_target?: string }[], note?: string): Observable<{ resolved_count: number }> {
    const body: Record<string, unknown> = { items };
    if (note?.trim()) body['note'] = note.trim();
    return this.http.post<{ resolved_count: number }>(`${this.base}/batch-resolve`, body);
  }
}
