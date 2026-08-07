import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { CurrentUser, DirectoryEntry } from './current-user.model';

// TODO(IT-AUTH): mirrors the `auth` service's provisional REQ-RDT-NAV-08 login — POST
// /auth-api/login exchanges username+password (verified against the `data_user` service +
// auth's own credentials.seed.json) for an opaque session token, kept IN MEMORY ONLY (no
// localStorage/sessionStorage) — the server's session store is also
// in-memory and wiped on restart, so persisting the token client-side would just mean a
// refresh silently "worked" with a token the server no longer recognizes until the next API
// call 401s. A refresh always bounces back to Login instead. Replace once GMF IT confirms
// their real employee/user table + platform auth (rdt/docs/SRS.md section 3.7 open question) —
// at that point this whole service is deleted, not just its data source swapped.
//
// Restructured 24 Jul 2026: this service is now shared across every consuming app (rdt, future
// ibt), not owned by one of them — it calls the `auth` and `data_user` services DIRECTLY via
// stable proxy-prefix conventions (`/auth-api`, `/data-api`) rather than assuming whichever app
// hosts this component also happens to expose its own `/api/auth`/`/api/directory` shims. Every
// consuming app's dev server / host platform needs to proxy those two prefixes to wherever it
// runs the auth/data_user services (see rdt/frontend/dev-shell/proxy.conf.json for the local
// dev example).
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly authBase = '/auth-api';
  private readonly dataUserBase = '/data-api';
  private directory: Record<string, DirectoryEntry> = {};
  private readonly userSubject = new BehaviorSubject<CurrentUser | null>(null);
  readonly user$: Observable<CurrentUser | null> = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  loadDirectory(): Observable<Record<string, DirectoryEntry>> {
    return this.http
      .get<{ ok: boolean; employees: Record<string, DirectoryEntry> }>(`${this.dataUserBase}/employees`)
      .pipe(
        tap((res) => { if (res.ok) this.directory = res.employees; }),
        map((res) => res.employees),
      );
  }

  get directoryEntries(): Record<string, DirectoryEntry> {
    return this.directory;
  }

  login(username: string, password: string): Observable<CurrentUser> {
    return this.http
      .post<{ ok: boolean; token: string; user: DirectoryEntry; error?: string }>(`${this.authBase}/login`, { username, password })
      .pipe(
        map((res) => {
          if (!res.ok) throw new Error(res.error || 'Login gagal');
          const user: CurrentUser = { id: username, token: res.token, ...res.user };
          this.userSubject.next(user);
          return user;
        }),
      );
  }

  /** Best-effort — clears the client-side session regardless of whether the server call succeeds. */
  logout(): Observable<void> {
    const user = this.current;
    this.userSubject.next(null);
    if (!user) return of(undefined);
    return this.http
      .post<{ ok: boolean }>(`${this.authBase}/logout`, {}, { headers: new HttpHeaders({ 'X-Session-Token': user.token }) })
      .pipe(map(() => undefined), catchError(() => of(undefined)));
  }

  get current(): CurrentUser | null {
    return this.userSubject.value;
  }

  /** Headers for any authenticated request. Throws if nobody is logged in — callers should
   * guard on `current` first so this is a programming error, not a user-facing failure. */
  authHeaders(): HttpHeaders {
    const user = this.current;
    if (!user) throw new Error('No user logged in — check CurrentUserService.current before calling authHeaders()');
    return new HttpHeaders({ 'X-Session-Token': user.token });
  }
}
