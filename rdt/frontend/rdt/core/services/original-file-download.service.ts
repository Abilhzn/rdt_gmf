import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../api-config';

// `GET repost/persist/uploads/:uploadId/download` — download the original workbook byte-for-byte
// (not a re-export), available to whichever queue shows that upload's rows. Shared across
// Confirmation (Batch 6c) and Share-Cost (Batch 6f) — promoted to `core/` here rather than one
// feature reaching into another's service (was living in features/confirmation/ alone until now).
@Injectable({ providedIn: 'root' })
export class OriginalFileDownloadService {
  constructor(private http: HttpClient) {}

  downloadOriginal(uploadId: number): Observable<Blob> {
    return this.http.get(`${API_BASE}/repost/persist/uploads/${uploadId}/download`, { responseType: 'blob' });
  }
}
