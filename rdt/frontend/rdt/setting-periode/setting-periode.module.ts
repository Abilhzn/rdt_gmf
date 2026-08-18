import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { SettingPeriodeComponent } from './setting-periode.component';

// SRS 3.13 "Struktur navigasi disederhanakan lagi" (14 Agu): was split into 2 sub-pages
// ('deadline'/'active' child routes, REQ-RDT-SAP-20, 13 Agu) — DIBATALKAN, back to ONE flat
// component/route, no sub-nav.
@NgModule({
  declarations: [SettingPeriodeComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild([
      { path: '', component: SettingPeriodeComponent },
    ]),
  ],
})
export class SettingPeriodeModule {}
