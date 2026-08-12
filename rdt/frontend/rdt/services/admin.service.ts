import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface ExclusionsConfig {
  prefixes: string[];
}

// Checklist section 3 (12 Agu, loading-state/error-message audit): both admin editors
// (mapping-editor/exclusions-editor) used to call `fetch('/api/mapping')` directly, with NO
// X-Session-Token header at all — worked fine while those endpoints had zero auth (checklist 1.1
// gap), but broke outright the moment that gap got fixed (requireUser/requireRole('TAB') added).
// Pulled into a proper service using the same HttpClient + CurrentUserService.authHeaders()
// pattern every other feature in this app already uses (see e.g. export-batch.service.ts),
// instead of the one-off unauthenticated fetch() the admin pages had.
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
