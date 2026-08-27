import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { DashboardDetailPageComponent } from './pages/dashboard-detail-page.component';

// dashboard-detail nested HERE (not a sibling top-level route) so the "Dashboard" sidebar link +
// page title stay active/correct on the drill-down page too — it's reached only by clicking a
// Dashboard card, not a sidebar item (see shell.component.ts's route-tree-based lookup). Ported
// from home.module.ts (Batch 6d) — same nested-route pattern, just relocated + renamed.
@NgModule({
  declarations: [DashboardPageComponent, DashboardDetailPageComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild([
      { path: '', component: DashboardPageComponent },
      { path: 'detail/:initiator/:target', component: DashboardDetailPageComponent },
    ]),
  ],
})
export class DashboardModule {}
