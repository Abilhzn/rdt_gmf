import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-NAV-08 — gates the app shell behind an active session. ui-demo.html's session is
// deliberately in-memory only (no localStorage), so a refresh always bounces back to Login
// (see CurrentUserService's header comment) — this guard mirrors that exactly rather than
// trying to restore/validate a persisted token.
//
// This is still just the client-side UX gate, not the security boundary — the real enforcement
// is server-side (middleware/auth.js), same as before.
//
// Redirect is built from `route.pathFromRoot` rather than a hardcoded '/login' so this keeps
// working wherever the host platform mounts RdtModule (dev-shell mounts it under '/rdt') —
// `route` here is the ShellComponent's own ('' path) snapshot, whose own url contributes
// nothing, so the flattened path is exactly the module's mount prefix, and 'login' its sibling.
// (CanActivate only hands us a snapshot, not a live ActivatedRoute, so createUrlTree's
// relativeTo — which requires the latter — isn't usable here.)
@Injectable({ providedIn: 'root' })
export class RdtGuard implements CanActivate {
  constructor(private currentUser: CurrentUserService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    if (this.currentUser.current) return true;
    const mountPrefix = route.pathFromRoot.flatMap((snap) => snap.url).map((seg) => seg.path);
    return this.router.parseUrl('/' + [...mountPrefix, 'login'].join('/'));
  }
}
