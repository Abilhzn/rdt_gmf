import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { SettingDeadlineComponent } from './setting-deadline.component';
import { RepostActiveComponent } from './repost-active.component';

// REQ-RDT-SAP-20 (13 Agu split): was one component ('' path); now two sub-pages under this same
// module — "Setting Deadline" (default) and "'Repost' Active" — see shell.component.html's nav-
// group for 'setting-periode' and shell.component.ts's syncFromRoute() for the matching titles.
@NgModule({
  declarations: [SettingDeadlineComponent, RepostActiveComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild([
      { path: '', redirectTo: 'deadline', pathMatch: 'full' },
      { path: 'deadline', component: SettingDeadlineComponent },
      { path: 'active', component: RepostActiveComponent },
    ]),
  ],
})
export class SettingPeriodeModule {}
