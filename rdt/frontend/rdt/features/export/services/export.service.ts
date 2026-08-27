import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';

// `repost/export` — TAB-only on every endpoint EXCEPT `history` (force-scoped to the caller's own
// dinas_inisiasi for non-TAB, not closed off entirely). Format TAB (8-column) is the ONLY export
// format now — the old 53-column "contract" format was removed entirely, so there's no more
// `?format=` query param on the download endpoints.

export interface WaitingEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  /** Overdue pairs stay in "Wait to Repost" (not filtered out) — flags the "Overdue" tag, sticky
   * per the periode_efektif snapshot. */
  overdue: boolean;
  state_label: string;
}

export interface ConfirmExportResult {
  batch_id: number;
  attached_count: number;
  notified_user_ids: string[];
  subdoc_number: string;
}

export interface AddSubdocResult {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

export interface HistorySubdoc {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

// Backend sends every batch column (t.*) — index signature so callers can read any of them by
// key, named fields stay for the ones components read directly.
export interface HistoryBatch {
  [column: string]: unknown;
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  period: string | null;
  /** The period this pasangan actually archives under — equal to `period` unless the dinas
   * TARGET's Confirm/Reject action came after a deadline TAB set, in which case it shifts to the
   * next month. */
  period_efektif: string | null;
  overdue: boolean;
  state_label: string;
  subdocs: HistorySubdoc[];
  subdoc_numbers: string[];
  confirmed_at: string;
}

// Backend sends every transaction column (SELECT *) — index signature so the dynamic-column
// renderer can read any of them by key.
export interface TransparencyRow {
  [key: string]: string | number | boolean | null | undefined;
  id: number;
  account: string;
  nominal: number;
  remark: string | null;
  ref_doc: string | null;
  status_konfirmasi: string;
  reassigned_from: string | null;
  reassign_count: number;
}

// One transaction line within a batch, annotated with which subdoc (if any) already covers it —
// used by the subdoc-entry picker (GET :batchId/lines, TAB-only).
export interface BatchLine {
  id: number;
  account: unknown;
  nominal: unknown;
  remark: unknown;
  ref_doc: unknown;
  subdoc_id: number | null;
  subdoc_number: string | null;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly base = `${API_BASE}/repost/export`;

  constructor(private http: HttpClient) {}

  getWaiting(): Observable<WaitingEntry[]> {
    return this.http.get<WaitingEntry[]>(`${this.base}/waiting`);
  }

  // Archived batches (>=1 subdoc). periode (optional, 'YYYY-MM') filters against the batch's
  // declared/effective period. NOT TAB-only — auto-scoped server-side, no dinas query param to
  // send (and none rendered client-side either, see history-page.component).
  getHistory(periode?: string): Observable<HistoryBatch[]> {
    const qs = periode ? `?periode=${encodeURIComponent(periode)}` : '';
    return this.http.get<HistoryBatch[]>(`${this.base}/history${qs}`);
  }

  getTransparency(dinasInisiasi: string, dinasTarget: string): Observable<TransparencyRow[]> {
    return this.http.get<TransparencyRow[]>(`${this.base}/transparency/${encodeURIComponent(dinasInisiasi)}/${encodeURIComponent(dinasTarget)}`);
  }

  // One form, one call — closing_description AND the first subdoc_number together. transactionIds
  // is optional (>300-line overflow: cover only a subset with this first subdoc, add the rest
  // afterward via addSubdoc()).
  confirm(dinasInisiasi: string, dinasTarget: string, closingDescription: string, subdocNumber: string, transactionIds?: number[]): Observable<ConfirmExportResult> {
    return this.http.post<ConfirmExportResult>(`${this.base}/confirm`, {
      dinas_inisiasi: dinasInisiasi,
      dinas_target: dinasTarget,
      closing_description: closingDescription,
      subdoc_number: subdocNumber,
      transaction_ids: transactionIds,
    });
  }

  // A batch can take more than one subdoc over time (SAP's ~300 line item cap). transactionIds
  // omitted = every transaction in this batch not yet covered by an earlier subdoc (the common
  // single-subdoc case); pass a subset to split a batch across several subdocs.
  addSubdoc(batchId: number, subdocNumber: string, transactionIds?: number[]): Observable<AddSubdocResult> {
    return this.http
      .post<{ subdoc: AddSubdocResult }>(`${this.base}/${batchId}/subdocs`, { subdoc_number: subdocNumber, transaction_ids: transactionIds })
      .pipe(map((res) => res.subdoc));
  }

  // TAB-only. Every line in a batch with its current subdoc assignment.
  getBatchLines(batchId: number): Observable<BatchLine[]> {
    return this.http.get<BatchLine[]>(`${this.base}/${batchId}/lines`);
  }

  // Returns the full response, not just the Blob — >300 rows comes back as a .zip instead of
  // .xlsx, and the caller needs Content-Disposition's filename to know which one it got.
  downloadExport(batchId: number): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/export/${batchId}`, { responseType: 'blob', observe: 'response' });
  }

  // Download directly off a still-unbatched pair (no batch/confirm needed yet), for the "Waiting
  // to repost" list. Format TAB is the only format the backend serves now — no `?format=` param.
  getExportPair(dinasInisiasi: string, dinasTarget: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/export-pair/${encodeURIComponent(dinasInisiasi)}/${encodeURIComponent(dinasTarget)}`, { responseType: 'blob', observe: 'response' });
  }
}
