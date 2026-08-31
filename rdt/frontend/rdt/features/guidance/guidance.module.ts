import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { GuidancePageComponent } from './pages/guidance-page.component';

@NgModule({
  declarations: [GuidancePageComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: GuidancePageComponent },
  ])],
})
export class GuidanceModule {}
