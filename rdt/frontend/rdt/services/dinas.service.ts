import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUserService } from '@auth/services/current-user.service';

export interface DinasEntry {
  code: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class DinasService {
  private readonly base = '/api';

  constructor(private http: HttpClient, private currentUser: CurrentUserService) {}

  getActiveDinas(): Observable<DinasEntry[]> {
    // Checklist 3 (12 Agu, caught during manual browser smoke test after service restart): went
    // out with NO auth header — broke silently once checklist 1.1 added requireUser to
    // GET /api/dinas (dropdown-populating callers like confirm.component's reassign-target
    // pickers just rendered empty, no visible error). Same regression class as
    // TransactionService.getContractFields — see that method's own comment for the full story.
    return this.http
      .get<{ ok: boolean; dinas: DinasEntry[] }>(`${this.base}/dinas`, { headers: this.currentUser.authHeaders() })
      .pipe(map((res) => (res.ok ? res.dinas : [])));
  }
}
