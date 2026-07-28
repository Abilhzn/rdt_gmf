import { Routes } from '@angular/router';

// dev-shell exists only to `ng serve` the RdtModule that already lives at
// ../rdt (linked in via an NTFS junction at src/app/rdt — see README.md).
// Not the real integration path; that's angular-integration-sample/README.md.
export const routes: Routes = [
  { path: 'rdt', loadChildren: () => import('./rdt/rdt.module').then((m) => m.RdtModule) },
  { path: '', redirectTo: 'rdt', pathMatch: 'full' },
];
