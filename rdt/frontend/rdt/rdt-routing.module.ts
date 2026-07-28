import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { RepostBudgetingComponent } from './pages/repost-budgeting/repost-budgeting.component';
import { LoginComponent } from '@auth/auth/login.component';
import { SelectPlatformComponent } from '@auth/auth/select-platform.component';
import { RdtGuard } from './guards/rdt.guard';

// REQ-RDT-NAV-01/05/08 — restructured from the old single-page-at-root layout into
// Dashboard/Repost/Confirmation/Need Approval siblings under a persistent ShellComponent
// (sidebar + topbar), mirroring the hash-based view switching in ui-demo.html. '' redirects
// to 'dashboard' since Dashboard is now the landing page under the shell. "Guidance
// Application"/"Feedback Application" from the updated Figma sidebar are inert placeholders
// (no spec/annotation exists for them) — not routed.
//
// login/select-platform sit OUTSIDE the shell (no sidebar/topbar there, ground truth
// ui-demo.html's screen-login/screen-select-platform). RdtGuard on the shell route redirects
// to /login whenever there's no active session — including on a plain refresh, since the
// session is deliberately in-memory only (see CurrentUserService).
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
      { path: 'need-approval', loadChildren: () => import('./need-approval/need-approval.module').then(m => m.NeedApprovalModule) },
      { path: 'admin', loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule) },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RdtRoutingModule {}
