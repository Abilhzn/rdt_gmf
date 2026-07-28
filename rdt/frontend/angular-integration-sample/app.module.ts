import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, RouterModule.forRoot([
    { path: 'rdt', loadChildren: () => import('./rdt/rdt.module').then(m => m.RdtModule) },
    { path: '', redirectTo: '/rdt', pathMatch: 'full' }
  ])],
  bootstrap: [AppComponent]
})
export class AppModule {}
