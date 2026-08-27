import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../../../core/api-config';
export { triggerBlobDownload } from '../../../core/utils/blob-download.util';

// Backend sends every transaction column (`t.*`) — index signature so the dynamic-column renderer
// (confirm-page's previewColumns) can read any of them by key. Named fields below stay because
// components still read them directly for non-dynamic purposes (chain badge, redirect picker,
// filters). Port of `confirmation.service.ts` (old `services/`) against backend's
// `repost/confirmation` (`ConfirmationService.getQueue`'s `QueueRow`).
export interface PendingRow {
  [key: string]: string | number | boolean | null | undefined | string[];
  id: number;
  account?: string;
  nominal: number;
  category?: string;
  remark?: string;
  /** The sticky "Notes" column reads THIS field, not `remark` — the uploading user's own per-row
   * note from the Repost Review step (migration 015). */
  reviewer_note?: string;
  ref_doc?: string;
  dinas_inisiasi?: string;
  dinas_target?: string;
  reassign_count?: number;
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
  private readonly base = `${API_BASE}/repost/confirmation`;

  constructor(private http: HttpClient) {}

  getPending(dinas: string): Observable<PendingRow[]> {
    return this.http.get<PendingRow[]>(`${this.base}/${encodeURIComponent(dinas)}`);
  }

  // Returns which rows ended up DECLINED (waiting on the initiator) vs REDIRECTED (the declining
  // PIC picked a new dinas directly — executes immediately) in this submit, so the caller doesn't
  // need a separate refetch. `description`: optional note the confirming dinas attaches to this
  // submit — posted server-side as a reply under the initiator's repost-description comment in
  // the pair's Dashboard-Detailing thread.
  submit(dinas: string, decisions: { id: number; claim: ConfirmationClaim; redirect_to?: string }[], description?: string): Observable<SubmitOutcome> {
    return this.http.post<SubmitOutcome>(`${this.base}/${encodeURIComponent(dinas)}/submit`, { decisions, description: description?.trim() || '' });
  }
}
