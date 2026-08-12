import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { ParseResponse, CommitResponse, Transaction, AggregationMatrix } from './transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-NAV-04 (1 Agu): the exact 53-column contract used for the real SAP export
// (exportBatches.js's CONTRACT_FIELDS) — fetched from the backend so the Repost Review preview
// table has ONE shared source of columns instead of a second, separately hardcoded list.
export interface ContractField {
  key: string;
  label: string;
}

/**
 * Semua panggilan API modul RDT lewat service ini — JANGAN pakai fetch()
 * langsung di komponen. Alasannya: HttpClient ikut interceptor platform
 * (auth token, error handling global) yang nanti dipasang tim IT, sedangkan
 * fetch() lewat begitu saja tanpa auth. (Lihat SRS 2.4.)
 */
@Injectable({ providedIn: 'root' })
export class TransactionService {
  // TODO(integrasi): ganti dengan base URL/environment config platform tim IT.
  private readonly base = '/api';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  // "Dinas pengunggah" is no longer a manual field — it mirrors whichever dinas the logged-in
  // account belongs to (see CurrentUserService).
  uploadAndParse(file: File): Observable<ParseResponse> {
    const user = this.currentUser.current;
    if (!user) return throwError(() => new Error('Pilih "Login sebagai" dulu — dinas pengunggah mengikuti akun yang login.'));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('uploaderDinas', user.dinas);
    return this.http.post<ParseResponse>(`${this.base}/parse`, fd, { headers: this.currentUser.authHeaders() });
  }

  commitToStaging(rows: Transaction[], aggregation: AggregationMatrix): Observable<CommitResponse> {
    return this.http.post<CommitResponse>(`${this.base}/commit`, { rows, aggregation });
  }

  // Bug fix: rdt.uploads.original_filename is
  // NOT NULL in the schema, but this never sent it — persisting a real file would 500 on
  // that constraint. dinas_code/uploaded_by_user_id are now derived server-side from the
  // X-User-Id header (never trusted from the body) — see index.js's /api/persist.
  // `description` is item 6's optional free-text note on the Repost submit.
  //
  // REQ-RDT-EXT-08: now sent as multipart with the actual File object attached (field "file"),
  // not just JSON — the server saves those bytes so REQ-RDT-LEDGER-09's download-with-live-
  // formulas has something to serve later. rows/aggregation travel as JSON-stringified fields
  // since multipart fields are plain strings; index.js's /api/persist parses them back.
  // REQ-RDT-SAP-13 (3 Agu): `period` ("YYYY-MM") is required — the dinas pengaju states which
  // month/year this DT is FOR, never inferred from the upload timestamp. Backend rejects a
  // missing/malformed value; the Angular form also gates Confirm on it (see
  // repost-budgeting.component.ts) so this never actually round-trips empty in practice.
  persistToDatabase(rows: Transaction[], aggregation: AggregationMatrix, originalFile: File | null, period: string, description?: string): Observable<CommitResponse> {
    const user = this.currentUser.current;
    if (!user) return throwError(() => new Error('Pilih "Login sebagai" dulu.'));
    const fd = new FormData();
    fd.append('rows', JSON.stringify(rows));
    fd.append('aggregation', JSON.stringify(aggregation));
    fd.append('original_filename', originalFile?.name || 'unknown.xlsx');
    fd.append('description', description?.trim() || '');
    fd.append('period', period);
    if (originalFile) fd.append('file', originalFile);
    return this.http.post<CommitResponse>(`${this.base}/persist`, fd, { headers: this.currentUser.authHeaders() });
  }

  getContractFields(): Observable<ContractField[]> {
    // Checklist 3 (12 Agu, caught during manual browser smoke test after service restart): this
    // call went out with NO auth header at all — broke silently (previewColumns just stayed
    // empty, no visible error to the user) once checklist 1.1 added requireUser to
    // GET /api/contract-fields. Same regression class as admin/mapping-editor's fetch() bug,
    // just missed during the original loading-state/error-message audit because this call
    // doesn't have its own explicit error handler — see confirm.component.ts, need-approval,
    // repost-budgeting, share-cost, all of which call this.
    return this.http
      .get<{ ok: boolean; fields: ContractField[]; error?: string }>(`${this.base}/contract-fields`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat daftar kolom kontrak');
        return res.fields;
      }));
  }
}
