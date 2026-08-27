import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { API_BASE } from '../../../core/api-config';
import { Transaction } from '../../../shared/models/transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';

/** `POST repost/upload/parse` response (`upload.controller.ts`). `objectName` is the storage key
 * of the just-uploaded workbook (server-internal bookkeeping, not needed by the client — `persist`
 * re-sends the file itself, it doesn't reference this). */
export interface ParseResponse {
  objectName: string;
  rowCount: number;
  rows: Transaction[];
}

/** `POST repost/persist` response (`persist.service.ts`'s `PersistResult`). */
export interface PersistResponse {
  inserted: number;
  upload_id: number;
  duplicates_flagged: number;
  superseded_upload_ids: number[];
  superseded_transaction_count: number;
}

/** Repost / upload-and-persist calls — replaces the stale `TransactionService` (53-column
 * contract format). `HttpClient` here goes through `core/interceptors` (identity-bridge stamps
 * dev-mock headers, response-unwrap strips `{data,message}`) — no manual header/unwrap work here. */
@Injectable({ providedIn: 'root' })
export class RepostService {
  private readonly base = `${API_BASE}/repost`;

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  // "Dinas pengunggah" mirrors whichever dinas the logged-in account belongs to.
  uploadAndParse(file: File): Observable<ParseResponse> {
    const user = this.currentUser.current;
    if (!user) return throwError(() => new Error('Pilih "Login sebagai" dulu — dinas pengunggah mengikuti akun yang login.'));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('uploaderDinas', user.dinas);
    return this.http.post<ParseResponse>(`${this.base}/upload/parse`, fd);
  }

  // rows travel JSON-stringified (multipart fields are plain strings); original file re-attached
  // so the server has bytes for "download original" later. `description` optional, periode is
  // derived server-side (bulan sebelum bulan upload berjalan) — not sent from here.
  persist(rows: Transaction[], originalFile: File | null, description?: string): Observable<PersistResponse> {
    const fd = new FormData();
    fd.append('rows', JSON.stringify(rows));
    fd.append('original_filename', originalFile?.name || 'unknown.xlsx');
    fd.append('description', description?.trim() || '');
    if (originalFile) fd.append('file', originalFile);
    return this.http.post<PersistResponse>(`${this.base}/persist`, fd);
  }
}
