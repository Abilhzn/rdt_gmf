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
// LoginComponent/SelectPlatformComponent live in the shared AuthModule — a component can only be
// declared by one NgModule, so RdtModule just imports+re-routes to them (see
// auth/frontend/auth.module.ts). TimeoutInterceptor registered via HTTP_INTERCEPTORS (works
// alongside HttpClientModule above regardless of whether the host platform provides
// HttpClientModule at its own root instead — see the CATATAN INTEGRASI above).
@NgModule({
  declarations: [ShellComponent, ModalComponent, RepostBudgetingComponent, ErrorPageComponent],
  imports: [CommonModule, FormsModule, HttpClientModule, RouterModule, RdtRoutingModule, SharedModule, AuthModule],
  providers: [{ provide: HTTP_INTERCEPTORS, useClass: TimeoutInterceptor, multi: true }],
})
export class RdtModule {}
