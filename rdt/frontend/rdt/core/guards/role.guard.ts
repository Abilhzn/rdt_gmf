import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { CurrentUserService } from '@auth/services/current-user.service';

// RdtGuard only checks "is anyone logged in" — this catches a plain PIC typing a TAB-only route
// (need-approval, setting-periode, share-cost) directly into the URL bar, redirecting
// before the page's API calls start 403-ing (backend enforcement via backend's
// `RolesGuard`/`DinasAccessGuard` was always solid — this is a client-side UX gap on top of that).
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
