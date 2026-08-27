import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { routes } from './app.routes';
import { IdentityBridgeInterceptor } from './rdt/core/interceptors/identity-bridge.interceptor';
import { ResponseUnwrapInterceptor } from './rdt/core/interceptors/response-unwrap.interceptor';
import { TimeoutInterceptor } from './rdt/core/interceptors/timeout.interceptor';

// RdtModule (src/frontend/rdt) predates zoneless Angular and relies throughout on the classic
// pattern of manual .subscribe() + plain field mutation to update the view (no signals, no
// markForCheck) — that needs zone.js-driven change detection to work at all. Explicit here
// (not just importing the 'zone.js' polyfill) because Angular 22's default scheduler doesn't
// reliably pick up plain RxJS subscribe callbacks otherwise. This mirrors whatever the real
// host platform (GMF's existing Angular app) almost certainly already runs.
//
// ponytail: the three HTTP_INTERCEPTORS registered inside RdtModule's own `providers` (rdt.module.ts)
// NEVER actually run — RepostService/DashboardService/etc. are `providedIn: 'root'`, so the HttpClient
// they inject is instantiated at the app ROOT injector (this file), not RdtModule's lazy child
// injector (`loadChildren`) where those interceptors live; DI only walks up, never into children.
// Confirmed live via QA (2026-08-27): upload/parse returns rows fine over the wire but the component
// sees `res = {data, message}` unwrapped — response-unwrap interceptor silently never fires. Dev-shell
// stopgap only — re-declaring the same interceptor classes here so dev-shell QA is meaningful. The
// REAL fix belongs to the IT handoff decision already flagged in rdt.module.ts's "CATATAN INTEGRASI"
// comment: either the host platform must register these same interceptors at ITS root, or the
// RdtModule services need to stop being `providedIn: 'root'` and instead be module-scoped. Do not
// treat this duplication as the resolved fix.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: IdentityBridgeInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: ResponseUnwrapInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: TimeoutInterceptor, multi: true },
  ]
};
