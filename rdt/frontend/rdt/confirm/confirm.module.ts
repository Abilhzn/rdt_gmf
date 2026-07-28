import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ConfirmComponent } from './confirm.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [ConfirmComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    // Always auto-resolves to the logged-in user's own dinas (see confirm.component.ts).
    // Optional ?from=<dinas> query param filters to one initiator dinas — set when
    // navigating here from Dashboard's "Need to Confirm" buttons.
    { path: '', component: ConfirmComponent },
  ])]
})
export class ConfirmModule {}
