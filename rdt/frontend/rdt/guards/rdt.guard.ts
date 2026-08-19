import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { CurrentUserService } from '@auth/services/current-user.service';

// Gates the app shell behind an active session. The session is deliberately in-memory only (no
// localStorage), so a refresh always bounces back to Login — this guard mirrors that rather than
// trying to restore/validate a persisted token. This is just the client-side UX gate, not the
// security boundary — real enforcement is server-side (middleware/auth.js).
//
// Redirect is built from `route.pathFromRoot` rather than a hardcoded '/login' so this keeps
// working wherever the host platform mounts RdtModule (dev-shell mounts it under '/rdt') — the
// flattened path is exactly the module's mount prefix, with 'login' as its sibling. CanActivate
// only hands us a snapshot, not a live ActivatedRoute, so createUrlTree's relativeTo isn't usable.
@Injectable({ providedIn: 'root' })
export class RdtGuard implements CanActivate {
  constructor(private currentUser: CurrentUserService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    if (this.currentUser.current) return true;
    const mountPrefix = route.pathFromRoot.flatMap((snap) => snap.url).map((seg) => seg.path);
    return this.router.parseUrl('/' + [...mountPrefix, 'login'].join('/'));
  }
}
