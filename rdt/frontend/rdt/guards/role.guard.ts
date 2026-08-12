import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { CurrentUserService } from '@auth/services/current-user.service';

// Checklist section 3 (12 Agu): RdtGuard only ever checked "is anyone logged in" — a plain PIC
// typing /rdt/admin/mapping (or need-approval, setting-periode, share-cost — all TAB-only
// features) directly into the URL bar got into the shell with zero visual cue, only finding out
// something was wrong once the page's own API calls started 403-ing (backend enforcement, see
// middleware/auth.js's requireRole, was always solid — this is purely a client-side UX gap on
// top of that, same "client-side is UX, server-side is the real boundary" split RdtGuard's own
// header comment already states).
//
// Route `data: { requiredRole: 'TAB' }` — factored as data instead of a route-specific guard
// class so adding another TAB-only route later is a one-line route config change, not a new file.
@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private currentUser: CurrentUserService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const requiredRole = route.data && route.data['requiredRole'];
    if (!requiredRole) return true; // misconfigured route (no requiredRole set) — fail open, not the guard's job to enforce nothing
    if (this.currentUser.current?.role === requiredRole) return true;
    return this.router.parseUrl('/rdt/forbidden');
  }
}
