import { Component, OnInit } from '@angular/core';
import { ExportBatchService, HistoryBatch } from '../services/export-batch.service';
import { triggerBlobDownload } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';

// REQ-RDT-SAP-10 "Riwayat Repost TAB" — the archive destination for REQ-RDT-SAP-09 (a batch
// leaves Need Approval's "Sudah Confirmed" the instant it gets its first subdoc, see
// need-approval.component's addSubdoc). Also the in-app substitute for the deferred email
// notification (SMTP infra out of scope for now) — PICs already got their in-app notification +
// comment at Confirm time (POST /confirm), this page is a browsable log on top for TAB, not a
// replacement for that. TAB-only, same gate as Need Approval (see shell.component's
// canSeeNeedApproval / this route's own guard via ShellComponent's RdtGuard + backend's
// requireRole('TAB') on every /api/export-batches route).
@Component({
  selector: 'rdt-repost-history',
  standalone: false,
  templateUrl: './repost-history.component.html',
  styleUrls: ['./repost-history.component.scss'],
})
export class RepostHistoryComponent implements OnInit {
  batches: HistoryBatch[] = [];
  errorMessage = '';
  from = '';
  to = '';

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.errorMessage = '';
    this.exportBatches.getHistory(this.from || undefined, this.to || undefined).subscribe({
      next: (batches) => { this.batches = batches; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat riwayat repost'; },
    });
  }

  clearFilter(): void {
    this.from = '';
    this.to = '';
    this.load();
  }

  download(batch: HistoryBatch): void {
    this.exportBatches.downloadExport(batch.id).subscribe({
      next: (blob) => {
        const dateStr = new Date().toISOString().slice(0, 10);
        triggerBlobDownload(blob, `${batch.dinas_inisiasi}-${batch.dinas_target}_${dateStr}.xlsx`);
      },
      error: async (err) => { await this.modal.alert('Gagal mengunduh: ' + (err?.message || err)); },
    });
  }
}
