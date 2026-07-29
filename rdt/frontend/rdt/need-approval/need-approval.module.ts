import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NeedApprovalComponent } from './need-approval.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [NeedApprovalComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([{ path: '', component: NeedApprovalComponent }])],
})
export class NeedApprovalModule {}
