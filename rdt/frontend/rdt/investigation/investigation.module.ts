import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InvestigationComponent } from './investigation.component';

@NgModule({
  declarations: [InvestigationComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild([{ path: '', component: InvestigationComponent }])],
})
export class InvestigationModule {}
