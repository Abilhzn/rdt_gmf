import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ConfirmPageComponent } from './pages/confirm-page.component';
import { PendingQueueComponent } from './components/pending-queue.component';
import { DeclinedResolutionComponent } from './components/declined-resolution.component';
import { InvestigationPanelComponent } from './components/investigation-panel.component';
import { CommentThreadComponent } from './components/comment-thread.component';

@NgModule({
  declarations: [ConfirmPageComponent, PendingQueueComponent, DeclinedResolutionComponent, InvestigationPanelComponent, CommentThreadComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    // Always auto-resolves to the logged-in user's own dinas (see confirm-page.component.ts).
    // Optional ?from=<dinas> query param filters to one initiator dinas — set when navigating
    // here from Dashboard's "Need to Confirm" buttons.
    { path: '', component: ConfirmPageComponent },
  ])],
})
export class ConfirmationModule {}
