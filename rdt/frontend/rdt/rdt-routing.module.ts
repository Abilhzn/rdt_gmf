import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { ErrorPageComponent } from './shared/error-page.component';
import { LoginComponent } from '@auth/auth/login.component';
import { SelectPlatformComponent } from '@auth/auth/select-platform.component';
import { RdtGuard } from './core/guards/rdt.guard';
import { RoleGuard } from './core/guards/role.guard';

// Dashboard/Repost/Confirmation/Need Approval siblings under a persistent ShellComponent
// (sidebar + topbar). '' redirects to 'dashboard', the landing page under the shell.
//
// login/select-platform sit OUTSIDE the shell (no sidebar/topbar there). RdtGuard on the shell
// route redirects to /login whenever there's no active session — including on a plain refresh,
// since the session is deliberately in-memory only (see CurrentUserService).
const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'select-platform', component: SelectPlatformComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [RdtGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadChildren: () => import('./features/dashboard/dashboard.module').then(m => m.DashboardModule) },
      { path: 'repost', loadChildren: () => import('./features/repost/repost.module').then(m => m.RepostModule) },
      { path: 'confirm', loadChildren: () => import('./features/confirmation/confirmation.module').then(m => m.ConfirmationModule) },
      // RoleGuard on every TAB-only route — see its own header comment for why.
      { path: 'need-approval', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./features/export/waiting.module').then(m => m.WaitingModule) },
      { path: 'share-cost', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./features/share-cost/share-cost.module').then(m => m.ShareCostModule) },
      { path: 'repost-history', loadChildren: () => import('./features/export/history.module').then(m => m.HistoryModule) },
      { path: 'setting-periode', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./features/period-deadlines/period-deadlines.module').then(m => m.PeriodDeadlinesModule) },
      // Tersedia untuk semua role login — murni dokumentasi, tak ada akses data sensitif.
      { path: 'guidance', loadChildren: () => import('./features/guidance/guidance.module').then(m => m.GuidanceModule) },
      // Informative 403 — RoleGuard above redirects here instead of leaving a role-mismatched
      // user in a broken page.
      { path: 'forbidden', component: ErrorPageComponent, data: { code: 403 } },
    ],
  },
  // Informative 404 for anything under /rdt/... that isn't a real route. Outside the shell (a bad
  // URL might not correspond to any valid in-shell state) but still reachable without login.
  { path: '**', component: ErrorPageComponent, data: { code: 404 } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RdtRoutingModule {}
