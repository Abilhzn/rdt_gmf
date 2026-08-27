import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';

export interface InvestigationRow {
  id: number;
  sheet_name: string | null;
  raw_row_index: number | null;
  account: unknown;
  nominal: string;
  category: unknown;
  remark: unknown;
  ref_doc: unknown;
  dinas_inisiasi: string;
  upload_id: number;
  upload_filename: string;
  created_at: string;
}

// TAB-only queue of rows whose dinas signal was the literal "Ask TA" (ambiguous ownership, needs
// manual TAB investigation before a real dinas_target exists) — `repost/investigation`
// (`investigation.service.ts`'s `InvestigationRow`, TAB-only, RolesGuard server-side).
@Injectable({ providedIn: 'root' })
export class InvestigationService {
  private readonly base = `${API_BASE}/repost/investigation`;

  constructor(private http: HttpClient) {}

  list(): Observable<InvestigationRow[]> {
    return this.http.get<InvestigationRow[]>(this.base);
  }

  assign(transactionId: number, dinasTarget: string, description?: string): Observable<string> {
    return this.http
      .post<{ dinas_target: string }>(`${this.base}/${transactionId}/assign`, { dinas_target: dinasTarget, description })
      .pipe(map((res) => res.dinas_target));
  }

  // Same "assign one-by-one or all at once" shape as Confirmation's declined-row batch resolve.
  // The backend independently enforces the all-or-nothing rule (every item must already have a
  // target) — this isn't just a UI nicety.
  assignAll(items: { transaction_id: number; dinas_target: string }[], description?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/assign-all`, { items, description });
  }
}
