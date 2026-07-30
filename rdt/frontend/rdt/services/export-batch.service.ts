import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-SAP-03..10 (SRS.md 3.3, 30 Jul) — Need Approval per PASANGAN (dinas_inisiasi,
// dinas_target). See routes/exportBatches.js's header comment for the full design rationale
// (WAITING/CONFIRMED/archived-with-subdoc are the only states, WAITING is computed not stored,
// no EXPORTED state, one batch = exactly one pair). state_label (REQ-RDT-SAP-07) is a derived
// display string from the backend (rules/stateLabel.js), never stored/computed here.

export interface WaitingEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  state_label: string;
}

export interface ConfirmedBatch {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  closing_description: string;
  confirmed_by_user_id: string;
  confirmed_at: string;
  created_at: string;
  state_label: string;
}

// REQ-RDT-SAP-11 — one subdoc entry with the transaction ids it actually covers, not just the
// bare number.
export interface SubdocDetail {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

// REQ-RDT-SAP-10 "Riwayat Repost TAB/Dinas" — a ConfirmedBatch plus the subdoc(s) that archived
// it (SAP-11: full linkage, not just the bare numbers — subdoc_numbers stays as a flat
// convenience list derived from `subdocs`).
export interface HistoryBatch extends ConfirmedBatch {
  subdocs: SubdocDetail[];
  subdoc_numbers: string[];
}

export interface TransparencyRow {
  id: number;
  account: string;
  nominal: number;
  remark: string | null;
  ref_doc: string | null;
  status_konfirmasi: string;
  reassigned_from: string | null;
  reassign_count: number;
}

export interface Subdoc {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

// REQ-RDT-SAP-11 — one transaction line within a batch, annotated with which subdoc (if any)
// already covers it. Used by the subdoc-entry picker (GET /:batchId/lines, TAB-only).
export interface BatchLine {
  id: number;
  account: string;
  nominal: number;
  remark: string | null;
  ref_doc: string | null;
  subdoc_id: number | null;
  subdoc_number: string | null;
}

@Injectable({ providedIn: 'root' })
export class ExportBatchService {
  private readonly base = '/api/export-batches';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getWaiting(): Observable<WaitingEntry[]> {
    return this.http
      .get<{ ok: boolean; waiting: WaitingEntry[]; error?: string }>(`${this.base}/waiting`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat antrian Need Approval');
        return res.waiting;
      }));
  }

  getConfirmed(): Observable<ConfirmedBatch[]> {
    return this.http
      .get<{ ok: boolean; batches: ConfirmedBatch[]; error?: string }>(`${this.base}/confirmed`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat batch terkonfirmasi');
        return res.batches;
      }));
  }

  // REQ-RDT-SAP-10 — archived batches (>=1 subdoc). from/to are optional YYYY-MM-DD period bounds
  // against confirmed_at.
  getHistory(from?: string, to?: string): Observable<HistoryBatch[]> {
    const params: string[] = [];
    if (from) params.push(`from=${encodeURIComponent(from)}`);
    if (to) params.push(`to=${encodeURIComponent(to)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.http
      .get<{ ok: boolean; batches: HistoryBatch[]; error?: string }>(`${this.base}/history${qs}`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat riwayat repost');
        return res.batches;
      }));
  }

  getTransparency(dinasInisiasi: string, dinasTarget: string): Observable<TransparencyRow[]> {
    return this.http
      .get<{ ok: boolean; transactions: TransparencyRow[]; error?: string }>(
        `${this.base}/transparency/${encodeURIComponent(dinasInisiasi)}/${encodeURIComponent(dinasTarget)}`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat transparansi');
        return res.transactions;
      }));
  }

  confirm(dinasInisiasi: string, dinasTarget: string, closingDescription: string): Observable<number> {
    return this.http
      .post<{ ok: boolean; batch_id: number; error?: string }>(
        `${this.base}/confirm`,
        { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, closing_description: closingDescription },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal confirm');
        return res.batch_id;
      }));
  }

  // REQ-RDT-SAP-08/11 — a batch can take more than one subdoc over time (SAP's ~300 line item
  // cap). transactionIds omitted = every transaction in this batch not yet covered by an earlier
  // subdoc (the common single-subdoc case); pass a subset to split a batch across several
  // subdocs (see getBatchLines for the picker data).
  addSubdoc(batchId: number, subdocNumber: string, transactionIds?: number[]): Observable<Subdoc> {
    return this.http
      .post<{ ok: boolean; subdoc: Subdoc; error?: string }>(
        `${this.base}/${batchId}/subdocs`,
        { subdoc_number: subdocNumber, transaction_ids: transactionIds },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal menambah subdoc');
        return res.subdoc;
      }));
  }

  // REQ-RDT-SAP-11 — TAB-only. Every line in a batch with its current subdoc assignment, so the
  // subdoc-entry UI can show/pick which unassigned rows go into a new subdoc number.
  getBatchLines(batchId: number): Observable<BatchLine[]> {
    return this.http
      .get<{ ok: boolean; lines: BatchLine[]; error?: string }>(`${this.base}/${batchId}/lines`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat baris batch');
        return res.lines;
      }));
  }

  downloadExport(batchId: number): Observable<Blob> {
    return this.http.get(`${this.base}/export/${batchId}`, {
      headers: this.currentUser.authHeaders(),
      responseType: 'blob',
    });
  }
}
