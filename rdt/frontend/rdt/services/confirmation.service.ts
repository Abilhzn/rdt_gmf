import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

// Backend sends every transaction column (`t.*`) — index signature so the dynamic-column renderer
// (confirm.component.ts's previewColumns, same pattern need-approval.component.ts's transparency
// table uses) can read any of them by key. Named fields below stay because the component still
// reads them directly for non-dynamic purposes (chain badge, redirect picker, filters).
export interface PendingRow {
  [key: string]: string | number | boolean | null | undefined | string[];
  id: number;
  account?: string;
  nominal: number;
  category?: string;
  remark?: string;
  /** The sticky "Notes" column reads THIS field, not `remark` — the uploading user's own per-row
   * note from the Repost Review step, persisted (migration 015). */
  reviewer_note?: string;
  ref_doc?: string;
  dinas_inisiasi?: string;
  /** Upload asal baris ini, buat tombol download file original per upload. */
  upload_id?: number;
  upload_filename?: string;
  /** This row's own full redirect breadcrumb (initiator -> every intermediate hop -> current
   * target) — a plain 2-point [dinas_inisiasi, dinas_target] when never reassigned. */
  chain?: string[];
}

export interface DeclinedOutcomeRow {
  id: number;
  account?: string;
  nominal: number;
  remark?: string;
  ref_doc?: string;
  dinas_inisiasi?: string;
}

export interface RedirectedOutcomeRow extends DeclinedOutcomeRow {
  redirected_to: string;
}

export interface SubmitOutcome {
  declined: DeclinedOutcomeRow[];
  redirected: RedirectedOutcomeRow[];
}

export type ConfirmationClaim = 'YA' | 'TIDAK';

@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  private readonly base = '/api/confirmation';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getPending(dinas: string): Observable<PendingRow[]> {
    return this.http
      .get<{ ok: boolean; rows: PendingRow[]; error?: string }>(`${this.base}/${encodeURIComponent(dinas)}`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'Gagal memuat data pending');
        return res.rows;
      }));
  }

  // Returns which rows ended up DECLINED (waiting on the initiator) vs REDIRECTED (the declining
  // PIC picked a new dinas directly — executes immediately) in this submit, so the caller doesn't
  // need a separate refetch. `description`: optional note the confirming dinas attaches to this
  // submit — posted server-side as a reply under the initiator's repost-description comment in
  // the pair's Dashboard-Detailing thread.
  submit(dinas: string, decisions: { id: number; claim: ConfirmationClaim; redirect_to?: string }[], description?: string): Observable<SubmitOutcome> {
    return this.http
      .post<{ ok: boolean; declined?: DeclinedOutcomeRow[]; redirected?: RedirectedOutcomeRow[]; error?: string }>(`${this.base}/${encodeURIComponent(dinas)}/submit`, { decisions, description: description?.trim() || '' }, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'submit failed');
        return { declined: res.declined || [], redirected: res.redirected || [] };
      }));
  }

  // Fetch the original workbook as a blob and trigger a normal browser "save file" — a plain
  // <a href> can't carry the X-User-Id auth header, so this goes through HttpClient instead.
  downloadOriginal(uploadId: number, filename: string): Observable<Blob> {
    return this.http.get(`/api/uploads/${uploadId}/download`, { headers: this.currentUser.authHeaders(), responseType: 'blob' });
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The export endpoints return EITHER a .xlsx (<=300 rows) OR a .zip of chunk-N.xlsx files (>300
// rows) — the server puts the right extension in Content-Disposition, read it from there instead
// of guessing client-side. `fallback` covers only the pathological case of a response with no
// header at all.
export function filenameFromResponse(headers: { get(name: string): string | null }, fallback: string): string {
  const disposition = headers.get('Content-Disposition') || headers.get('content-disposition');
  const match = disposition ? /filename="?([^";]+)"?/.exec(disposition) : null;
  return match ? match[1] : fallback;
}
