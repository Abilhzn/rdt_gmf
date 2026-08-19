import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HomeComponent } from './home.component';
import { DashboardDetailComponent } from '../dashboard-detail/dashboard-detail.component';
import { SharedModule } from '../shared/shared.module';

// dashboard-detail nested HERE (not a sibling top-level route) so the "Dashboard" sidebar link +
// page title stay active/correct on the drill-down page too — it's reached only by clicking a
// Dashboard card, not a sidebar item (see shell.component.ts's route-tree-based lookup).
@NgModule({
  declarations: [HomeComponent, DashboardDetailComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild([
      { path: '', component: HomeComponent },
      { path: 'detail/:initiator/:target', component: DashboardDetailComponent },
    ]),
  ],
})
export class HomeModule {}
