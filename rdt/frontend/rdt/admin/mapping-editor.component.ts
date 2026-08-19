import { Component, OnInit } from '@angular/core';
import { AdminService } from '../services/admin.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// Uses AdminService (proper HttpClient + auth headers), ModalService instead of native alert(),
// a loading state, and extractErrorMessage so a save/load failure shows the actual backend reason.
@Component({
  selector: 'rdt-mapping-editor',
  standalone: false,
  template: `
    <h3>Mapping Normalisasi Dinas</h3>
    <p>Editor sederhana untuk mapping prefix → dinas. Edit JSON lalu klik Simpan.</p>
    <p *ngIf="loading">Memuat...</p>
    <p *ngIf="errorMessage" style="color:#b3261e">{{ errorMessage }}</p>
    <textarea [(ngModel)]="txt" rows="8" style="width:100%" [disabled]="loading || saving"></textarea>
    <div style="margin-top:8px;">
      <button (click)="save()" [disabled]="loading || saving">{{ saving ? 'Menyimpan...' : 'Simpan' }}</button>
    </div>
  `,
})
export class MappingEditorComponent implements OnInit {
  txt = '{}';
  loading = false;
  saving = false;
  errorMessage = '';

  constructor(private admin: AdminService, private modal: ModalService) {}

  ngOnInit(): void {
    this.loading = true;
    this.admin.getMapping().subscribe({
      next: (mapping) => { this.txt = JSON.stringify(mapping, null, 2); this.loading = false; },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat mapping'); this.loading = false; },
    });
  }

  async save(): Promise<void> {
    let obj: Record<string, string>;
    try {
      obj = JSON.parse(this.txt);
    } catch (e) {
      await this.modal.alert('JSON tidak valid: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    this.saving = true;
    this.errorMessage = '';
    this.admin.saveMapping(obj).subscribe({
      next: async () => { this.saving = false; await this.modal.success('Mapping tersimpan.'); },
      error: async (err) => { this.saving = false; await this.modal.alert('Gagal menyimpan: ' + extractErrorMessage(err, String(err))); },
    });
  }
}
