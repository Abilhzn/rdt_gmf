import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { WaitingPageComponent } from './pages/waiting-page.component';

// Mounted at the 'need-approval' route (TAB-only via RoleGuard, rdt-routing.module.ts) — URL kept
// as-is, only the folder moved under features/export/ (Batch 6e).
@NgModule({
  declarations: [WaitingPageComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild([
    { path: '', component: WaitingPageComponent },
  ])],
})
export class WaitingModule {}
