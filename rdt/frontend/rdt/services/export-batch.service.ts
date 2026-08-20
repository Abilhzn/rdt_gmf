import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

// Need Approval per PASANGAN (dinas_inisiasi, dinas_target) — see routes/exportBatches.js's header
// comment for the full design rationale (WAITING is computed not stored, one batch = exactly one
// pair). state_label is a derived display string from the backend (rules/stateLabel.js), never
// stored/computed here. confirm() bundles the first subdoc_number into the same call as
// closing_description — a batch is created WITH its first subdoc already attached, so every batch
// this service can create is immediately a Batch with >=1 subdoc. Download doesn't need a batch to
// exist first — see getExportPair().

export interface WaitingEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  /** Overdue pairs stay in "Wait to Repost" (not filtered out) — this flags them for the
   * "Overdue" tag, sticky per routes/exportBatches.js's isOverdue (periode_efektif snapshot). */
  overdue: boolean;
  state_label: string;
}

export interface Batch {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  closing_description: string;
  confirmed_by_user_id: string;
  confirmed_at: string;
  created_at: string;
  state_label: string;
  /** "YYYY-MM" declared at Repost time (rdt.uploads.period), derived server-side from this
   * batch's transactions — null for legacy batches. This is the DECLARED period (what the data
   * is actually FOR) — kept for audit purposes, but history groups by `period_efektif` below. */
  period: string | null;
  /** The period this pasangan actually archives under — equal to `period` unless the dinas
   * TARGET's Confirm/Reject action came after a deadline TAB set (rdt.period_deadlines), in which
   * case it shifts to the next month. Null when `period` itself is null. */
  period_efektif: string | null;
  /** True when `period_efektif` shifted away from `period` because the dinas target
   * confirmed/rejected after its deadline. Always false when TAB never set a deadline. */
  overdue: boolean;
}

// One TAB-set deadline for a (dinas_inisiasi, dinas_target, periode) triple. See
// routes/periodDeadlines.js.
export interface PeriodDeadline {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  periode: string;
  deadline_at: string;
  set_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// One TAB-set default deadline for a periode ALONE, set in advance before any pasangan for that
// periode even exists yet. See routes/periodDeadlines.js's POST/GET /default.
export interface PeriodDefaultDeadline {
  periode: string;
  deadline_at: string;
  set_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// One row in "Override Deadline"'s list: a pasangan that's 100% confirmed for this periode but
// un-batched, whose periode_efektif already shifted away from the declared periode (overdue).
// See routes/periodDeadlines.js's GET /overdue.
export interface OverdueDeadlineEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  periode_efektif: string;
}

// One currently-active (not yet 100% resolved) pasangan for a given periode — see
// routes/periodDeadlines.js's GET /active-pairs.
export interface ActivePairEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  open_count: number;
}

// One subdoc entry with the transaction ids it actually covers, not just the bare number.
export interface SubdocDetail {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

// "Riwayat Repost TAB/Dinas" — a Batch plus the subdoc(s) that archived it (full linkage, not just
// the bare numbers — subdoc_numbers stays as a flat convenience list derived from `subdocs`).
export interface HistoryBatch extends Batch {
  subdocs: SubdocDetail[];
  subdoc_numbers: string[];
}

// Backend sends every contract column (SELECT *) — index signature so the dynamic-column renderer
// (need-approval.component.ts's previewColumns, same pattern as repost-budgeting) can read any of
// them by key. The named fields below stay because the component still reads them directly for
// non-dynamic purposes (Reassign column, filtering).
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

export interface Subdoc {
  id: number;
  subdoc_number: string;
  created_at: string;
  transaction_ids: number[];
}

// One transaction line within a batch, annotated with which subdoc (if any) already covers it.
// Used by the subdoc-entry picker (GET /:batchId/lines, TAB-only).
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

  // Archived batches (>=1 subdoc). periode (optional, 'YYYY-MM') filters against the batch's
  // declared/effective period.
  getHistory(periode?: string): Observable<HistoryBatch[]> {
    const qs = periode ? `?periode=${encodeURIComponent(periode)}` : '';
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

  // One form, one call — closing_description AND the first subdoc_number together. transactionIds
  // is optional (>300-line overflow: cover only a subset with this first subdoc, add the rest
  // afterward via addSubdoc() from Riwayat Repost TAB).
  confirm(dinasInisiasi: string, dinasTarget: string, closingDescription: string, subdocNumber: string, transactionIds?: number[]): Observable<number> {
    return this.http
      .post<{ ok: boolean; batch_id: number; error?: string }>(
        `${this.base}/confirm`,
        { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, closing_description: closingDescription, subdoc_number: subdocNumber, transaction_ids: transactionIds },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal confirm');
        return res.batch_id;
      }));
  }

  // A batch can take more than one subdoc over time (SAP's ~300 line item cap). transactionIds
  // omitted = every transaction in this batch not yet covered by an earlier subdoc (the common
  // single-subdoc case); pass a subset to split a batch across several subdocs (see
  // getBatchLines for the picker data).
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

  // TAB-only. Every line in a batch with its current subdoc assignment, so the subdoc-entry UI
  // can show/pick which unassigned rows go into a new subdoc number.
  getBatchLines(batchId: number): Observable<BatchLine[]> {
    return this.http
      .get<{ ok: boolean; lines: BatchLine[]; error?: string }>(`${this.base}/${batchId}/lines`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat baris batch');
        return res.lines;
      }));
  }

  // Returns the full response, not just the Blob — >300 rows comes back as a .zip instead of
  // .xlsx, and the caller needs Content-Disposition's filename (via
  // confirmation.service.ts's filenameFromResponse) to know which one it got.
  downloadExport(batchId: number): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/export/${batchId}`, {
      headers: this.currentUser.authHeaders(),
      responseType: 'blob',
      observe: 'response',
    });
  }

  // Download directly off a still-unbatched pair (no batch/confirm needed yet), for the
  // "Waiting to repost" list. format='tab' gets the 8-column Format TAB output (SRS.md "TERJAWAB
  // 15 Agu") instead of the default full 53-column contract format.
  getExportPair(dinasInisiasi: string, dinasTarget: string, format?: 'tab'): Observable<HttpResponse<Blob>> {
    const qs = format === 'tab' ? '?format=tab' : '';
    return this.http.get(`${this.base}/export-pair/${encodeURIComponent(dinasInisiasi)}/${encodeURIComponent(dinasTarget)}${qs}`, {
      headers: this.currentUser.authHeaders(),
      responseType: 'blob',
      observe: 'response',
    });
  }

  // TAB-only, separate router (routes/periodDeadlines.js), not part of /api/export-batches.
  // dinasInisiasi/dinasTarget optional filter for "existing deadlines for this pair" in the
  // management panel; omit both for the full list.
  private readonly deadlinesBase = '/api/period-deadlines';

  getPeriodDeadlines(dinasInisiasi?: string, dinasTarget?: string): Observable<PeriodDeadline[]> {
    const params: string[] = [];
    if (dinasInisiasi) params.push(`dinas_inisiasi=${encodeURIComponent(dinasInisiasi)}`);
    if (dinasTarget) params.push(`dinas_target=${encodeURIComponent(dinasTarget)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.http
      .get<{ ok: boolean; deadlines: PeriodDeadline[]; error?: string }>(`${this.deadlinesBase}${qs}`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat deadline periode');
        return res.deadlines;
      }));
  }

  // Upsert — setting again for the same (dinas_inisiasi, dinas_target, periode) UPDATES the
  // existing deadline, not a duplicate. This is the per-pasangan OVERRIDE — for the normal "one
  // deadline for everyone" workflow, see setDefaultPeriodDeadline below.
  setPeriodDeadline(dinasInisiasi: string, dinasTarget: string, periode: string, deadlineAt: string): Observable<PeriodDeadline> {
    return this.http
      .post<{ ok: boolean; deadline: PeriodDeadline; error?: string }>(
        this.deadlinesBase,
        { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget, periode, deadline_at: deadlineAt },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal menyimpan deadline periode');
        return res.deadline;
      }));
  }

  // The ONLY Setting Deadline action — upserts the periode-wide default AND sweeps/backfills it
  // onto every currently-active pasangan in that periode, atomically, in one call. A pasangan
  // that shows up LATER for this periode without its own per-pasangan override inherits
  // `deadline` automatically (rules/periodEffective.js's pickDeadline).
  setDefaultPeriodDeadline(periode: string, deadlineAt: string): Observable<{ deadline: PeriodDefaultDeadline; swept: PeriodDeadline[] }> {
    return this.http
      .post<{ ok: boolean; deadline: PeriodDefaultDeadline; swept: PeriodDeadline[]; error?: string }>(
        `${this.deadlinesBase}/default`,
        { periode, deadline_at: deadlineAt },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal menyimpan deadline default periode');
        return { deadline: res.deadline, swept: res.swept };
      }));
  }

  getDefaultPeriodDeadlines(): Observable<PeriodDefaultDeadline[]> {
    return this.http
      .get<{ ok: boolean; deadlines: PeriodDefaultDeadline[]; error?: string }>(
        `${this.deadlinesBase}/default`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat deadline default periode');
        return res.deadlines;
      }));
  }

  // Deletable only while its deadline hasn't passed yet (backend's own guard, 400 if already
  // passed).
  deleteDefaultPeriodDeadline(periode: string): Observable<void> {
    return this.http
      .delete<{ ok: boolean; error?: string }>(
        `${this.deadlinesBase}/default/${encodeURIComponent(periode)}`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal menghapus deadline default periode');
      }));
  }

  // Pasangan yang masih punya transaksi belum selesai (blocking status) di periode ini,
  // un-batched.
  getActivePairs(periode: string): Observable<ActivePairEntry[]> {
    return this.http
      .get<{ ok: boolean; active: ActivePairEntry[]; error?: string }>(
        `${this.deadlinesBase}/active-pairs?periode=${encodeURIComponent(periode)}`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat pasangan aktif');
        return res.active;
      }));
  }

  // "Overdue" list, informational — cap sticky, tidak ada aksi override yang menghapusnya.
  getOverdueDeadlines(periode: string): Observable<OverdueDeadlineEntry[]> {
    return this.http
      .get<{ ok: boolean; overdue: OverdueDeadlineEntry[]; error?: string }>(
        `${this.deadlinesBase}/overdue?periode=${encodeURIComponent(periode)}`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat daftar overdue');
        return res.overdue;
      }));
  }

  // The periode-wide default deadline for the CURRENT auto-periode, for shell.component's
  // reminder banner. Only non-TAB-reachable route on this router — any logged-in user, not just TAB.
  getCurrentDeadlineReminder(): Observable<{ periode: string; deadline_at: string | null }> {
    return this.http
      .get<{ ok: boolean; periode: string; deadline_at: string | null; error?: string }>(
        `${this.deadlinesBase}/current-reminder`,
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat reminder deadline');
        return { periode: res.periode, deadline_at: res.deadline_at };
      }));
  }
}
