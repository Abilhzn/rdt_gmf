import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from './pagination.component';
import { MultiValueFilterComponent } from './multi-value-filter.component';
import { IdDatePipe } from './id-date.pipe';
import { MentionInputComponent } from './mention-input.component';
import { MentionTextComponent } from './mention-text.component';

// Angular only allows a component to be declared in one NgModule, so a component/pipe reused
// across lazy feature modules (RdtModule for Repost, ConfirmModule for Confirmation, HomeModule
// for Dashboard-Detailing, NeedApprovalModule, per REQ-RDT-NAV-07/09/REQ-RDT-COMMENT) needs a
// module of its own that all of them import.
@NgModule({
  declarations: [PaginationComponent, MultiValueFilterComponent, IdDatePipe, MentionInputComponent, MentionTextComponent],
  imports: [CommonModule, FormsModule],
  exports: [PaginationComponent, MultiValueFilterComponent, IdDatePipe, MentionInputComponent, MentionTextComponent],
})
export class SharedModule {}
