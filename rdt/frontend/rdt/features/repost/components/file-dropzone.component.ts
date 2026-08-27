import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Dumb: drag-drop / pick a .xlsx, or show the picked file + a "ganti file" reset. No HTTP. */
@Component({
  selector: 'rdt-file-dropzone',
  standalone: false,
  template: `
    <div
      class="dropzone"
      [class.dropzone--active]="isDragOver"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave()"
      (drop)="onDrop($event)"
    >
      <ng-container *ngIf="!selectedFile; else fileInfo">
        <p class="dropzone__hint">Tarik file .xlsx ke sini, atau</p>
        <label class="btn btn--ghost">
          Pilih file
          <input type="file" accept=".xlsx" (change)="onFileInput($event)" hidden />
        </label>
      </ng-container>
      <ng-template #fileInfo>
        <p class="dropzone__file">{{ selectedFile?.name }}</p>
        <p class="dropzone__meta">{{ ((selectedFile?.size || 0) / 1024 / 1024) | number: '1.1-1' }} MB</p>
        <button class="btn btn--link" type="button" (click)="resetRequested.emit()">Ganti file</button>
      </ng-template>
    </div>
  `,
})
export class FileDropzoneComponent {
  @Input() selectedFile: File | null = null;
  @Output() fileSelected = new EventEmitter<File>();
  @Output() resetRequested = new EventEmitter<void>();

  isDragOver = false;

  onFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) this.fileSelected.emit(input.files[0]);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = false;
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.fileSelected.emit(f);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }
}
