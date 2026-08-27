import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { RepostBudgetingPageComponent } from './pages/repost-budgeting-page.component';
import { FileDropzoneComponent } from './components/file-dropzone.component';
import { AggregationMatrixComponent } from './components/aggregation-matrix.component';
import { PreviewTableComponent } from './components/preview-table.component';

// Batch 6b: was a single top-level component declared directly in RdtModule — moved to its own
// lazy module (matches every other feature: confirm/, home/, need-approval/, ...) now that it's
// split into a page + 3 dumb children.
@NgModule({
  declarations: [RepostBudgetingPageComponent, FileDropzoneComponent, AggregationMatrixComponent, PreviewTableComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: RepostBudgetingPageComponent },
  ])],
})
export class RepostModule {}
