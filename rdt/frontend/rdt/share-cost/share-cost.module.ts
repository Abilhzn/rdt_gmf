import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ShareCostComponent } from './share-cost.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [ShareCostComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([{ path: '', component: ShareCostComponent }])],
})
export class ShareCostModule {}
