import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { RepostBudgetingComponent } from './pages/repost-budgeting/repost-budgeting.component';
import { ErrorPageComponent } from './shared/error-page.component';
import { LoginComponent } from '@auth/auth/login.component';
import { SelectPlatformComponent } from '@auth/auth/select-platform.component';
import { RdtGuard } from './guards/rdt.guard';
import { RoleGuard } from './guards/role.guard';

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
      { path: 'dashboard', loadChildren: () => import('./home/home.module').then(m => m.HomeModule) },
      { path: 'repost', component: RepostBudgetingComponent },
      { path: 'confirm', loadChildren: () => import('./confirm/confirm.module').then(m => m.ConfirmModule) },
      // RoleGuard on every TAB-only route — see its own header comment for why.
      { path: 'need-approval', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./need-approval/need-approval.module').then(m => m.NeedApprovalModule) },
      { path: 'share-cost', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./share-cost/share-cost.module').then(m => m.ShareCostModule) },
      { path: 'repost-history', loadChildren: () => import('./repost-history/repost-history.module').then(m => m.RepostHistoryModule) },
      { path: 'setting-periode', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./setting-periode/setting-periode.module').then(m => m.SettingPeriodeModule) },
      { path: 'admin', canActivate: [RoleGuard], data: { requiredRole: 'TAB' }, loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule) },
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
