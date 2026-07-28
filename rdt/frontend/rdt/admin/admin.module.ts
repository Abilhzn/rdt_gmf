import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MappingEditorComponent } from './mapping-editor.component';
import { ExclusionsEditorComponent } from './exclusions-editor.component';

@NgModule({
  declarations: [MappingEditorComponent, ExclusionsEditorComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild([
    { path: 'mapping', component: MappingEditorComponent },
    { path: 'exclusions', component: ExclusionsEditorComponent },
    { path: '', redirectTo: 'mapping', pathMatch: 'full' }
  ])]
})
export class AdminModule {}
