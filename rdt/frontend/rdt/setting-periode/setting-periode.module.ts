import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { SettingPeriodeComponent } from './setting-periode.component';

// Satu flat component/route, tanpa sub-nav — sempat di-split jadi 2 sub-halaman, dibatalkan.
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
