import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { HistoryPageComponent } from './pages/history-page.component';

// Mounted at the 'repost-history' route — NOT TAB-only (TAB sees every batch, non-TAB is
// force-scoped server-side to their own dinas_inisiasi, no bypass). URL kept as-is, only the
// folder moved under features/export/ (Batch 6e).
@NgModule({
  declarations: [HistoryPageComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: HistoryPageComponent },
  ])],
})
export class HistoryModule {}
