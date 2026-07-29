import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { RepostHistoryComponent } from './repost-history.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [RepostHistoryComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([{ path: '', component: RepostHistoryComponent }])],
})
export class RepostHistoryModule {}
