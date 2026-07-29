import { Component, OnInit } from '@angular/core';
import {
  ExportBatchService,
  WaitingEntry,
  ConfirmedBatch,
  TransparencyRow,
} from '../services/export-batch.service';
import { triggerBlobDownload } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';

// REQ-RDT-SAP-03..06 (SRS.md 3.3, SUPERSEDED 30 Jul) — full rewrite replacing the 29 Jul
// per-dinas_inisiasi UI. Approval unit is now one PASANGAN (dinas_inisiasi, dinas_target): a
// WAITING entry appears (computed, not stored) once that specific pair is resolved — other pairs
// from the same dinas_inisiasi never block or get blocked by it. TAB opens full transparency for
// that one pair (including DECLINED/reassigned history) before confirming with a mandatory
// closing description; only after that does the pair's Excel download (full 53 contract columns)
// become available — one batch = one pair now, so download is a direct button, no picker needed.
@Component({
  selector: 'rdt-need-approval',
  standalone: false,
  templateUrl: './need-approval.component.html',
  styleUrls: ['./need-approval.component.scss'],
})
export class NeedApprovalComponent implements OnInit {
  waiting: WaitingEntry[] = [];
  confirmed: ConfirmedBatch[] = [];
  errorMessage = '';

  // Transparency view: at most one pair expanded at a time, keyed "dinas_inisiasi dinas_target".
  expandedPairKey: string | null = null;
  transparencyRows: TransparencyRow[] = [];
  transparencyError = '';
  closingDescription = '';
  confirming = false;

  // REQ-RDT-SAP-08: subdoc entry is a separate step from Confirm, done any time after a batch
  // lands in "Sudah Confirmed" — one text input per batch row, keyed by batch id since more than
  // one row can be mid-entry at once (unlike transparency, which is single-expand).
  subdocInputByBatchId: Record<number, string> = {};
  addingSubdocBatchId: number | null = null;

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.errorMessage = '';
    this.exportBatches.getWaiting().subscribe({
      next: (waiting) => { this.waiting = waiting; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat antrian'; },
    });
    this.exportBatches.getConfirmed().subscribe({
      next: (confirmed) => { this.confirmed = confirmed; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat batch terkonfirmasi'; },
    });
  }

  pairKey(dinasInisiasi: string, dinasTarget: string): string {
    return `${dinasInisiasi} ${dinasTarget}`;
  }

  openTransparency(dinasInisiasi: string, dinasTarget: string): void {
    this.expandedPairKey = this.pairKey(dinasInisiasi, dinasTarget);
    this.transparencyError = '';
    this.closingDescription = '';
    this.transparencyRows = [];
    this.exportBatches.getTransparency(dinasInisiasi, dinasTarget).subscribe({
      next: (rows) => { this.transparencyRows = rows; },
      error: (err) => { this.transparencyError = err?.message || 'Gagal memuat transparansi'; },
    });
  }

  closeTransparency(): void {
    this.expandedPairKey = null;
    this.transparencyRows = [];
  }

  canConfirm(): boolean {
    return !!this.closingDescription.trim();
  }

  async confirmPair(dinasInisiasi: string, dinasTarget: string): Promise<void> {
    if (!this.canConfirm()) return;
    const ok = await this.modal.confirm(`Confirm repost ${dinasInisiasi} → ${dinasTarget}? Aksi ini tidak bisa dibatalkan.`);
    if (!ok) return;
    this.confirming = true;
    this.exportBatches.confirm(dinasInisiasi, dinasTarget, this.closingDescription.trim()).subscribe({
      next: async () => {
        this.confirming = false;
        await this.modal.success(`Repost ${dinasInisiasi} → ${dinasTarget} sudah dikonfirmasi`);
        this.closeTransparency();
        this.load();
      },
      error: async (err) => {
        this.confirming = false;
        await this.modal.alert('Error: ' + (err?.message || err));
      },
    });
  }

  download(batch: ConfirmedBatch): void {
    this.exportBatches.downloadExport(batch.id).subscribe({
      next: (blob) => {
        const dateStr = new Date().toISOString().slice(0, 10);
        triggerBlobDownload(blob, `${batch.dinas_inisiasi}-${batch.dinas_target}_${dateStr}.xlsx`);
      },
      error: async (err) => { await this.modal.alert('Gagal mengunduh: ' + (err?.message || err)); },
    });
  }

  // REQ-RDT-SAP-08/09: adding the FIRST subdoc archives this batch out of "Sudah Confirmed"
  // (backend excludes any batch with >=1 subdoc from GET /confirmed) into Riwayat Repost TAB —
  // so a successful add always means reloading this list, not just clearing the input.
  async addSubdoc(batch: ConfirmedBatch): Promise<void> {
    const subdocNumber = (this.subdocInputByBatchId[batch.id] || '').trim();
    if (!subdocNumber) return;
    this.addingSubdocBatchId = batch.id;
    this.exportBatches.addSubdoc(batch.id, subdocNumber).subscribe({
      next: async () => {
        this.addingSubdocBatchId = null;
        delete this.subdocInputByBatchId[batch.id];
        await this.modal.success(`Subdoc ${subdocNumber} ditambahkan untuk ${batch.dinas_inisiasi} → ${batch.dinas_target}`);
        this.load();
      },
      error: async (err) => {
        this.addingSubdocBatchId = null;
        await this.modal.alert('Gagal menambah subdoc: ' + (err?.message || err));
      },
    });
  }
}
