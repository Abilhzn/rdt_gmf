import { Component, OnInit } from '@angular/core';
import { AdminService, ExclusionsConfig } from '../services/admin.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// Same pattern as mapping-editor.component.ts — see its own header comment.
@Component({
  selector: 'rdt-exclusions-editor',
  standalone: false,
  template: `
    <h3>Prefix Eksklusi</h3>
    <p>Daftar prefix yang selalu di-exclude. Edit JSON &#123; "prefixes": ["AUAK","PO"] &#125;.</p>
    <p *ngIf="loading">Memuat...</p>
    <p *ngIf="errorMessage" style="color:#b3261e">{{ errorMessage }}</p>
    <textarea [(ngModel)]="txt" rows="4" style="width:100%" [disabled]="loading || saving"></textarea>
    <div style="margin-top:8px;">
      <button (click)="save()" [disabled]="loading || saving">{{ saving ? 'Menyimpan...' : 'Simpan' }}</button>
    </div>
  `,
})
export class ExclusionsEditorComponent implements OnInit {
  txt = '{"prefixes":[] }';
  loading = false;
  saving = false;
  errorMessage = '';

  constructor(private admin: AdminService, private modal: ModalService) {}

  ngOnInit(): void {
    this.loading = true;
    this.admin.getExclusions().subscribe({
      next: (exclusions) => { this.txt = JSON.stringify(exclusions, null, 2); this.loading = false; },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat exclusions'); this.loading = false; },
    });
  }

  async save(): Promise<void> {
    let obj: ExclusionsConfig;
    try {
      obj = JSON.parse(this.txt);
    } catch (e) {
      await this.modal.alert('JSON tidak valid: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    this.saving = true;
    this.errorMessage = '';
    this.admin.saveExclusions(obj).subscribe({
      next: async () => { this.saving = false; await this.modal.success('Exclusions tersimpan.'); },
      error: async (err) => { this.saving = false; await this.modal.alert('Gagal menyimpan: ' + extractErrorMessage(err, String(err))); },
    });
  }
}
