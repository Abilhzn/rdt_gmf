import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface InvestigationRow {
  id: number;
  sheet_name: string;
  raw_row_index: number;
  account: string;
  nominal: string;
  category: string;
  remark: string;
  ref_doc: string;
  dinas_inisiasi: string;
  upload_id: number;
  upload_filename: string;
  created_at: string;
}

// REQ-RDT-LEDGER-10 — see rdt/backend/src/routes/investigation.js. TAB-only queue of rows whose
// dinas signal was the literal "Ask TA" (ambiguous ownership, needs manual TAB investigation
// before a real dinas_target exists) — see rdt/docs/SRS.md REQ-RDT-LEDGER-10.
@Injectable({ providedIn: 'root' })
export class InvestigationService {
  private readonly base = '/api/investigation';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  list(): Observable<InvestigationRow[]> {
    return this.http
      .get<{ ok: boolean; rows: InvestigationRow[]; error?: string }>(this.base, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat antrian investigasi');
        return res.rows;
      }));
  }

  assign(transactionId: number, dinasTarget: string): Observable<string> {
    return this.http
      .post<{ ok: boolean; dinas_target: string; error?: string }>(
        `${this.base}/${transactionId}/assign`,
        { dinas_target: dinasTarget },
        { headers: this.currentUser.authHeaders() },
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'assign gagal');
        return res.dinas_target;
      }));
  }
}
