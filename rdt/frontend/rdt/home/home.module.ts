import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HomeComponent } from './home.component';
import { DashboardDetailComponent } from '../dashboard-detail/dashboard-detail.component';
import { SharedModule } from '../shared/shared.module';

// dashboard-detail nested HERE (not a sibling top-level route) precisely so the "Dashboard"
// sidebar link + page title stay active/correct on the drill-down page too — it's reached only
// by clicking a Dashboard card (REQ-RDT-NAV-03), not a sidebar item — it isn't one of the four
// VIEWS-with-own-nav-highlight either (see shell.component.ts's
// PAGE_TITLES/route-tree-based lookup, which resolves the segment 'dashboard' either way).
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
