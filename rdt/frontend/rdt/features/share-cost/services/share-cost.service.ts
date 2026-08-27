import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE } from '../../../core/api-config';

// Split satu baris PENDING jadi beberapa baris PENDING dengan dinas_target/nominal berbeda-beda.
// `share-cost` — TAB-only on the whole router.

export interface SplitCandidate {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  account: string;
  nominal: number;
  remark: string | null;
  ref_doc: string | null;
  period: string | null;
  upload_id: number;
  upload_filename: string;
}

export interface SplitLine {
  dinas_target: string;
  nominal: number;
}

@Injectable({ providedIn: 'root' })
export class ShareCostService {
  private readonly base = `${API_BASE}/share-cost`;

  constructor(private http: HttpClient) {}

  // Baris PENDING dinas_target='TAB' persis (nilai tersimpan, bukan join is_active).
  getCandidates(q?: string): Observable<SplitCandidate[]> {
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return this.http.get<{ rows: SplitCandidate[] }>(`${this.base}/candidates${qs}`).pipe(map((res) => res.rows));
  }

  split(transactionId: number, splits: SplitLine[], note: string): Observable<number[]> {
    return this.http
      .post<{ split_from: number; split_into: number[] }>(`${this.base}/${transactionId}/split`, { splits, note })
      .pipe(map((res) => res.split_into));
  }
}
