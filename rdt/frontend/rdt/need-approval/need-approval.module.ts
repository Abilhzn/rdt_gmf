import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NeedApprovalComponent } from './need-approval.component';

@NgModule({
  declarations: [NeedApprovalComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild([{ path: '', component: NeedApprovalComponent }])],
})
export class NeedApprovalModule {}
