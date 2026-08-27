import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CurrentUserService } from '@auth/services/current-user.service';
import { API_BASE } from '../api-config';

// Bridges two unrelated identity mechanisms. `CurrentUserService` (shared auth/frontend, login via
// `/auth-api` X-Session-Token — its own provisional thing, not touched here) is what this app's UI
// actually has. `backend`'s dev-mock identity provider (`IDENTITY_MODE=dev-mock`) instead
// reads plain `x-dev-user-id`/`x-dev-dinas`/`x-dev-role` headers — so every request THIS app makes
// to backend needs those headers stamped from `CurrentUserService.current`.
//
// Scoped to `API_BASE` only — `/auth-api`/`/data-api` calls (CurrentUserService's own login/
// directory calls) must NOT get these headers, they're a different backend with a different auth
// scheme entirely.
//
// In production behind OCX, identity is presumably injected by the host platform itself (cookie/
// header from OCX) — so this only sets a header when one isn't already present, defensively, in
// case the platform already stamped it upstream.
@Injectable()
export class IdentityBridgeInterceptor implements HttpInterceptor {
  constructor(private currentUser: CurrentUserService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!req.url.startsWith(API_BASE)) return next.handle(req);

    const user = this.currentUser.current;
    if (!user) return next.handle(req); // no session — let it through, backend 401s, that's correct

    let headers = req.headers;
    if (!headers.has('x-dev-user-id')) headers = headers.set('x-dev-user-id', user.id);
    if (!headers.has('x-dev-dinas')) headers = headers.set('x-dev-dinas', user.dinas);
    if (!headers.has('x-dev-role')) headers = headers.set('x-dev-role', user.role);

    return next.handle(req.clone({ headers }));
  }
}
