import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

// Split satu baris PENDING jadi beberapa baris PENDING dengan dinas_target/nominal berbeda-beda.
// Lihat backend/src/routes/shareCost.js's header comment untuk rincian asumsi.

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
  private readonly base = '/api/share-cost';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getCandidates(q?: string): Observable<SplitCandidate[]> {
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return this.http
      .get<{ ok: boolean; rows: SplitCandidate[]; error?: string }>(`${this.base}/candidates${qs}`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal memuat daftar baris');
        return res.rows;
      }));
  }

  split(transactionId: number, splits: SplitLine[], note: string): Observable<number[]> {
    return this.http
      .post<{ ok: boolean; split_into: number[]; error?: string }>(
        `${this.base}/${transactionId}/split`,
        { splits, note },
        { headers: this.currentUser.authHeaders() }
      )
      .pipe(map((res) => {
        if (!res.ok) throw new Error(res.error || 'gagal split transaksi');
        return res.split_into;
      }));
  }
}
