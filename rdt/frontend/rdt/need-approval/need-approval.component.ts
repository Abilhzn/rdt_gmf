import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ExportBatchService, ExportBatch } from '../services/export-batch.service';
import { ModalService } from '../services/modal.service';

// REQ-RDT-SAP-01/02 — moved out of Confirming into its own nav item/page, per the updated
// Figma sidebar (Dashboard/Repost/Confirmation/Need Approval/...). TAB-only (SM_TA/GH_TA
// removed entirely 24 Jul 2026, project owner correction — role TAB alone approves once
// everything is 100% confirmed). STUB: file generation is a placeholder only, no real SAP
// import column template exists yet (see rdt/backend/src/routes/exportBatches.js).
@Component({
  selector: 'rdt-need-approval',
  standalone: false,
  templateUrl: './need-approval.component.html',
  styleUrls: ['./need-approval.component.scss'],
})
export class NeedApprovalComponent implements OnInit {
  batches: ExportBatch[] = [];
  newBatchPeriod = '';
  errorMessage = '';

  constructor(
    public currentUser: CurrentUserService,
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.currentUser.user$.subscribe(() => this.load());
  }

  load(): void {
    this.errorMessage = '';
    if (!this.currentUser.current) return;
    this.exportBatches.list().subscribe({
      next: (batches) => { this.batches = batches; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat batch'; },
    });
  }

  async createBatch(): Promise<void> {
    if (!this.currentUser.current) { await this.modal.alert('Pilih "Login sebagai" dulu.'); return; }
    if (!this.newBatchPeriod.trim()) { await this.modal.alert('Isi label periode dulu.'); return; }
    this.exportBatches.create(this.newBatchPeriod.trim()).subscribe({
      next: () => { this.newBatchPeriod = ''; this.load(); },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  async batchAction(batch: ExportBatch, action: 'submit' | 'approve' | 'export'): Promise<void> {
    const ok = await this.modal.confirm('Apakah kamu sudah yakin?');
    if (!ok) return;
    const obs: Observable<void | { filename: string; stub: boolean; warning?: string }> =
      action === 'submit' ? this.exportBatches.submit(batch.id) :
      action === 'approve' ? this.exportBatches.approve(batch.id) :
      this.exportBatches.export(batch.id);
    obs.subscribe({
      next: async (res: any) => {
        if (res && res.stub) await this.modal.alert('Catatan: ' + (res.warning || 'file export masih placeholder'));
        this.load();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }
}
