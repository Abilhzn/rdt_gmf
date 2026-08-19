import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface ExclusionsConfig {
  prefixes: string[];
}

// Uses the same HttpClient + CurrentUserService.authHeaders() pattern every other feature in this
// app uses (see e.g. export-batch.service.ts) — these endpoints require auth (requireUser/
// requireRole('TAB')), so a plain unauthenticated fetch() would 401.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly base = '/api';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getMapping(): Observable<Record<string, string>> {
    return this.http
      .get<{ ok: boolean; mapping: Record<string, string> }>(`${this.base}/mapping`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => res.mapping || {}));
  }

  saveMapping(mapping: Record<string, string>): Observable<void> {
    return this.http
      .put<{ ok: boolean }>(`${this.base}/mapping`, mapping, { headers: this.currentUser.authHeaders() })
      .pipe(map(() => undefined));
  }

  getExclusions(): Observable<ExclusionsConfig> {
    return this.http
      .get<{ ok: boolean; exclusions: ExclusionsConfig }>(`${this.base}/exclusions`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => res.exclusions || { prefixes: [] }));
  }

  saveExclusions(exclusions: ExclusionsConfig): Observable<void> {
    return this.http
      .put<{ ok: boolean }>(`${this.base}/exclusions`, exclusions, { headers: this.currentUser.authHeaders() })
      .pipe(map(() => undefined));
  }
}
