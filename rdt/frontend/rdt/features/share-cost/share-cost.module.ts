import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ShareCostPageComponent } from './pages/share-cost-page.component';
import { SplitFormComponent } from './components/split-form.component';

@NgModule({
  declarations: [ShareCostPageComponent, SplitFormComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: ShareCostPageComponent },
  ])],
})
export class ShareCostModule {}
