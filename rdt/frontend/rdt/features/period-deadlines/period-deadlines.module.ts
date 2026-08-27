import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { PeriodDeadlinesPageComponent } from './pages/period-deadlines-page.component';

@NgModule({
  declarations: [PeriodDeadlinesPageComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: PeriodDeadlinesPageComponent },
  ])],
})
export class PeriodDeadlinesModule {}
