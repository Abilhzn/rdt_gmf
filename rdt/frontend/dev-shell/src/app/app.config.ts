import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

// RdtModule (src/frontend/rdt) predates zoneless Angular and relies throughout on the classic
// pattern of manual .subscribe() + plain field mutation to update the view (no signals, no
// markForCheck) — that needs zone.js-driven change detection to work at all. Explicit here
// (not just importing the 'zone.js' polyfill) because Angular 22's default scheduler doesn't
// reliably pick up plain RxJS subscribe callbacks otherwise. This mirrors whatever the real
// host platform (GMF's existing Angular app) almost certainly already runs.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes)
  ]
};
