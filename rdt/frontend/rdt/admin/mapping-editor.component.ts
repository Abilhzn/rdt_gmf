import { Component, OnInit } from '@angular/core';
import { AdminService } from '../services/admin.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// Checklist section 3 (12 Agu, loading-state/error-message audit): this used to call
// `fetch('/api/mapping')` directly with NO auth header at all — broke outright once checklist
// 1.1's fix added requireUser/requireRole('TAB') to that endpoint. Rewritten onto AdminService
// (proper HttpClient + CurrentUserService.authHeaders(), same pattern every other feature uses),
// ModalService instead of native alert() (consistent with the rest of the app), a real loading
// state (there wasn't one before — a slow network made this look frozen, no feedback at all),
// and extractErrorMessage so a save/load failure shows the actual backend reason.
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
