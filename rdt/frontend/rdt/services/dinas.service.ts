import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../core/api-config';

export interface DinasEntry {
  code: string;
  name: string;
}

// `GET /dinas` (backend's `DinasController`, root-level — not under `repost/`) — active dinas
// only (`is_active=true`), for picker/reassign dropdowns. Updated Batch 6c for the new response
// shape (plain `Dinas[]` via `{data,message}`, unwrapped — no more `{ok,dinas}`).
@Injectable({ providedIn: 'root' })
export class DinasService {
  private readonly base = API_BASE;

  constructor(private http: HttpClient) {}

  getActiveDinas(): Observable<DinasEntry[]> {
    return this.http.get<DinasEntry[]>(`${this.base}/dinas`);
  }
}
