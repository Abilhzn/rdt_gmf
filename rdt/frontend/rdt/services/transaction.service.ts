import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { ParseResponse, CommitResponse, Transaction, AggregationMatrix } from './transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';

// The exact 53-column contract used for the real SAP export (exportBatches.js's CONTRACT_FIELDS)
// — fetched from the backend so the Repost Review preview table has ONE shared source of columns.
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

  // rdt.uploads.original_filename is NOT NULL in the schema — always send it. dinas_code/
  // uploaded_by_user_id are derived server-side from the X-User-Id header (never trusted from the
  // body). `description` is the optional free-text note on the Repost submit. Sent as multipart
  // with the actual File object attached (field "file") — the server saves those bytes so
  // download-with-live-formulas has something to serve later; rows/aggregation travel as
  // JSON-stringified fields since multipart fields are plain strings. periode is not sent from
  // here — the server derives it (bulan sebelum bulan upload berjalan) in POST /api/persist.
  persistToDatabase(rows: Transaction[], aggregation: AggregationMatrix, originalFile: File | null, description?: string): Observable<CommitResponse> {
    const user = this.currentUser.current;
    if (!user) return throwError(() => new Error('Pilih "Login sebagai" dulu.'));
    const fd = new FormData();
    fd.append('rows', JSON.stringify(rows));
    fd.append('aggregation', JSON.stringify(aggregation));
    fd.append('original_filename', originalFile?.name || 'unknown.xlsx');
    fd.append('description', description?.trim() || '');
    if (originalFile) fd.append('file', originalFile);
    return this.http.post<CommitResponse>(`${this.base}/persist`, fd, { headers: this.currentUser.authHeaders() });
  }

  getContractFields(): Observable<ContractField[]> {
    // Must send the auth header — GET /api/contract-fields requires it server-side. Without it
    // this fails silently (previewColumns just stays empty, no visible error) since this call has
    // no explicit error handler of its own — see confirm/need-approval/repost-budgeting/share-cost.
    return this.http
      .get<{ ok: boolean; fields: ContractField[]; error?: string }>(`${this.base}/contract-fields`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat daftar kolom kontrak');
        return res.fields;
      }));
  }
}
