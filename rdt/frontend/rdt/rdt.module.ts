import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { ModalComponent } from './shared/modal.component';
import { SharedModule } from './shared/shared.module';
import { TimeoutInterceptor } from './shared/timeout.interceptor';
import { ErrorPageComponent } from './shared/error-page.component';
import { RepostBudgetingComponent } from './pages/repost-budgeting/repost-budgeting.component';
import { AuthModule } from '@auth/auth.module';
import { RdtRoutingModule } from './rdt-routing.module';

// CATATAN INTEGRASI: HttpClientModule kemungkinan besar sudah di-provide
// di root module platform tim IT — kalau iya, hapus dari imports di sini
// (double-provide HttpClientModule di lazy module bisa mereset interceptor).
// Disertakan sementara supaya modul bisa jalan standalone saat development.
//
// LoginComponent/SelectPlatformComponent moved OUT to the shared AuthModule (24 Jul 2026) — a
// component can only be declared by one NgModule, so RdtModule now just imports+re-routes to
// them instead of declaring them itself (see auth/frontend/auth.module.ts).
// Checklist 2.2 (12 Agu): TimeoutInterceptor registered via HTTP_INTERCEPTORS (the classic
// NgModule-compatible way — works alongside HttpClientModule above regardless of whether the
// real host platform ends up providing HttpClientModule at its own root instead, see this file's
// own CATATAN INTEGRASI above about double-provide risk being interceptor-reset, not
// interceptor-registration).
@NgModule({
  declarations: [ShellComponent, ModalComponent, RepostBudgetingComponent, ErrorPageComponent],
  imports: [CommonModule, FormsModule, HttpClientModule, RouterModule, RdtRoutingModule, SharedModule, AuthModule],
  providers: [{ provide: HTTP_INTERCEPTORS, useClass: TimeoutInterceptor, multi: true }],
})
export class RdtModule {}
