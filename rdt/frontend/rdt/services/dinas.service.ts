import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface DinasEntry {
  code: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class DinasService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  getActiveDinas(): Observable<DinasEntry[]> {
    return this.http
      .get<{ ok: boolean; dinas: DinasEntry[] }>(`${this.base}/dinas`)
      .pipe(map((res) => (res.ok ? res.dinas : [])));
  }
}
