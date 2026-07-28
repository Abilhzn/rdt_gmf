import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export type ExportBatchStatus = 'DRAFT' | 'WAITING_APPROVAL' | 'APPROVED' | 'EXPORTED' | 'CANCELLED';

export interface ExportBatch {
  id: number;
  period: string;
  status: ExportBatchStatus;
  created_by_user_id: string;
  created_at: string;
  approved_by_user_id?: string;
  approved_at?: string;
  exported_at?: string;
  export_filename?: string;
}

// REQ-RDT-SAP-01/02 — see src/backend/src/routes/exportBatches.js. Actual SAP flat-file
// generation is a stub (no real column template exists yet) — export() surfaces that via
// the `stub`/`warning` fields in the response rather than pretending it's a real file.
@Injectable({ providedIn: 'root' })
export class ExportBatchService {
  private readonly base = '/api/export-batches';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  list(): Observable<ExportBatch[]> {
    return this.http
      .get<{ ok: boolean; batches: ExportBatch[]; error?: string }>(this.base, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat batch');
        return res.batches;
      }));
  }

  create(period: string): Observable<number> {
    return this.http
      .post<{ ok: boolean; batch_id: number; error?: string }>(this.base, { period }, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal membuat batch');
        return res.batch_id;
      }));
  }

  submit(id: number): Observable<void> { return this.action(id, '/submit'); }
  approve(id: number): Observable<void> { return this.action(id, '/approve'); }

  export(id: number): Observable<{ filename: string; stub: boolean; warning?: string }> {
    return this.http
      .post<{ ok: boolean; filename: string; stub: boolean; warning?: string; error?: string }>(`${this.base}/${id}/export`, {}, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'export failed');
        return { filename: res.filename, stub: res.stub, warning: res.warning };
      }));
  }

  private action(id: number, path: string): Observable<void> {
    return this.http
      .post<{ ok: boolean; error?: string }>(`${this.base}/${id}${path}`, {}, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'aksi gagal');
      }));
  }
}
