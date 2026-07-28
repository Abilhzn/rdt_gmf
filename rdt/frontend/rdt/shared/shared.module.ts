import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaginationComponent } from './pagination.component';
import { IdDatePipe } from './id-date.pipe';

// Angular only allows a component to be declared in one NgModule, so a component/pipe reused
// across lazy feature modules (RdtModule for Repost, ConfirmModule for Confirmation, HomeModule
// for Dashboard-Detailing, per REQ-RDT-NAV-07/REQ-RDT-COMMENT) needs a module of its own that
// all of them import.
@NgModule({
  declarations: [PaginationComponent, IdDatePipe],
  imports: [CommonModule],
  exports: [PaginationComponent, IdDatePipe],
})
export class SharedModule {}
