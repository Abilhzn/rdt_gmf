import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SettingPeriodeComponent } from './setting-periode.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [SettingPeriodeComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([{ path: '', component: SettingPeriodeComponent }])],
})
export class SettingPeriodeModule {}
