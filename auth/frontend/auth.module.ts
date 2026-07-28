import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { LoginComponent } from './auth/login.component';
import { SelectPlatformComponent } from './auth/select-platform.component';

// Restructured out of rdt/frontend on 24 Jul 2026: Login + Select Platform are shared across
// every consuming app (rdt, future ibt), not owned by one of them — a component can only be
// declared by ONE NgModule (Angular's NG6007), so this is that one, and any consuming app's
// module imports THIS module instead of declaring these components itself.
//
// CATATAN INTEGRASI: HttpClientModule kemungkinan besar sudah di-provide di root module
// platform tim IT — kalau iya, hapus dari imports di sini (double-provide HttpClientModule di
// lazy module bisa mereset interceptor). Disertakan sementara supaya modul bisa jalan
// standalone saat development (mirrors rdt.module.ts's own note on this).
@NgModule({
  declarations: [LoginComponent, SelectPlatformComponent],
  imports: [CommonModule, FormsModule, HttpClientModule],
  exports: [LoginComponent, SelectPlatformComponent],
})
export class AuthModule {}
