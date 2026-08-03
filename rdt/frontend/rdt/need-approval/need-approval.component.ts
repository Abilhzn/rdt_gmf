import { Component, OnInit } from '@angular/core';
import {
  ExportBatchService,
  WaitingEntry,
  TransparencyRow,
} from '../services/export-batch.service';
import { triggerBlobDownload, filenameFromResponse } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';
import { matchesAllColumnFilters } from '../shared/multi-value-filter.component';
import { TransactionService, ContractField } from '../services/transaction.service';

interface PreviewColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

// REQ-RDT-SAP-03..06 (SRS.md 3.3) — approval unit is one PASANGAN (dinas_inisiasi, dinas_target):
// a WAITING entry appears (computed, not stored) once that specific pair is resolved — other
// pairs from the same dinas_inisiasi never block or get blocked by it. TAB can open full
// transparency for that one pair (including DECLINED/reassigned history), and can download the
// pair's Excel (full 53 contract columns) directly off this list.
//
// REQ-RDT-SAP-05 REVISED 31 Jul (presentation feedback): two changes from the earlier version —
// (1) download no longer waits for Confirm at all, it's one button per waiting entry; (2) Confirm
// is now ONE form (closing description + first subdoc number together, submitted in a single
// call) instead of Confirm-then-separately-add-a-subdoc. A batch is created WITH its first subdoc
// already attached, so it goes straight from this page's "Waiting" list into Riwayat Repost TAB —
// there is no more intermediate "confirmed, no subdoc yet" list here (see
// export-batch.service.ts's header comment for what that replaced).
@Component({
  selector: 'rdt-need-approval',
  standalone: false,
  templateUrl: './need-approval.component.html',
  styleUrls: ['./need-approval.component.scss'],
})
export class NeedApprovalComponent implements OnInit {
  waiting: WaitingEntry[] = [];
  errorMessage = '';

  // Transparency + confirm form: at most one pair expanded at a time, keyed
  // "dinas_inisiasi dinas_target".
  expandedPairKey: string | null = null;
  transparencyRows: TransparencyRow[] = [];
  transparencyError = '';
  closingDescription = '';
  subdocNumber = '';
  confirming = false;
  // REQ-RDT-NAV-09 (diperluas 1 Agu): satu filter multi-value per KOLOM, bukan cuma Account.
  transparencyColumnFilters: Record<string, string[]> = {};

  // REQ-RDT-NAV-04 (diperluas 1 Agu, DITEGASKAN LAGI 3 Agu): transparansi HARUS tampilkan SEMUA
  // kolom yang benar-benar ikut ter-repost — satu sumber (CONTRACT_FIELDS via GET
  // /api/contract-fields) sama persis yang dipakai repost-budgeting.component's previewColumns,
  // bukan subset Account/Ref.Doc/Nominal/Remark/Status yang di-hardcode terpisah seperti
  // sebelumnya.
  previewColumns: PreviewColumn[] = [];

  // Per-entry download-in-progress flag (waiting list, keyed by pairKey) — separate from
  // `confirming` above, which only applies to the expanded transparency panel's form.
  downloadingPairKey: string | null = null;

  get filteredTransparencyRows(): TransparencyRow[] {
    return this.transparencyRows.filter((r) => matchesAllColumnFilters(r, this.transparencyColumnFilters, (row, key) => (row as any)[key]));
  }

  onTransparencyColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.transparencyColumnFilters[key] = values;
    else delete this.transparencyColumnFilters[key];
  }

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
    private txService: TransactionService,
  ) {
    this.txService.getContractFields().subscribe((fields) => {
      this.previewColumns = this.buildPreviewColumns(fields);
    });
  }

  private buildPreviewColumns(fields: ContractField[]): PreviewColumn[] {
    const contractCols: PreviewColumn[] = fields.map((f) =>
      f.key === 'in_pclc' ? { key: 'in_pclc', label: 'Nominal', numeric: true } : { key: f.key, label: f.label },
    );
    return [
      { key: 'sub_group', label: 'Sub Group' },
      ...contractCols,
      { key: 'status_konfirmasi', label: 'Status' },
      { key: 'remark', label: 'Remark' },
    ];
  }

  getCellValue(row: TransparencyRow, key: string): string | number | null | undefined {
    return row[key] as string | number | null | undefined;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.errorMessage = '';
    this.exportBatches.getWaiting().subscribe({
      next: (waiting) => { this.waiting = waiting; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat antrian'; },
    });
  }

  pairKey(dinasInisiasi: string, dinasTarget: string): string {
    return `${dinasInisiasi} ${dinasTarget}`;
  }

  openTransparency(dinasInisiasi: string, dinasTarget: string): void {
    this.expandedPairKey = this.pairKey(dinasInisiasi, dinasTarget);
    this.transparencyError = '';
    this.closingDescription = '';
    this.subdocNumber = '';
    this.transparencyRows = [];
    this.transparencyColumnFilters = {};
    this.exportBatches.getTransparency(dinasInisiasi, dinasTarget).subscribe({
      next: (rows) => { this.transparencyRows = rows; },
      error: (err) => { this.transparencyError = err?.message || 'Gagal memuat transparansi'; },
    });
  }

  closeTransparency(): void {
    this.expandedPairKey = null;
    this.transparencyRows = [];
  }

  // REQ-RDT-SAP-05 (revised): Confirm now requires BOTH the closing description AND the first
  // subdoc number — "aksi Confirm yang sebenarnya = memasukkan nomor subdoc BERSAMAAN dengan
  // deskripsi penutup, dalam SATU aksi".
  canConfirm(): boolean {
    return !!this.closingDescription.trim() && !!this.subdocNumber.trim();
  }

  async confirmPair(dinasInisiasi: string, dinasTarget: string): Promise<void> {
    if (!this.canConfirm()) return;
    const ok = await this.modal.confirm(`Confirm repost ${dinasInisiasi} → ${dinasTarget} dengan subdoc ${this.subdocNumber.trim()}? Aksi ini tidak bisa dibatalkan.`);
    if (!ok) return;
    this.confirming = true;
    this.exportBatches.confirm(dinasInisiasi, dinasTarget, this.closingDescription.trim(), this.subdocNumber.trim()).subscribe({
      next: async () => {
        this.confirming = false;
        await this.modal.success(`Repost ${dinasInisiasi} → ${dinasTarget} sudah dikonfirmasi dan tercatat di Riwayat Repost TAB.`);
        this.closeTransparency();
        this.load();
      },
      error: async (err) => {
        this.confirming = false;
        await this.modal.alert('Error: ' + (err?.message || err));
      },
    });
  }

  // REQ-RDT-SAP-05/06 (revised): download is available the instant a pair shows up here — no
  // batch/Confirm needed first. Reads directly off the pair's still-unbatched CONFIRMED rows.
  // REQ-RDT-SAP-06 auto-split (1 Agu): >300 rows comes back as a .zip instead of .xlsx — the
  // actual filename (with the right extension) comes from the response, not guessed client-side.
  download(entry: WaitingEntry): void {
    const key = this.pairKey(entry.dinas_inisiasi, entry.dinas_target);
    this.downloadingPairKey = key;
    this.exportBatches.getExportPair(entry.dinas_inisiasi, entry.dinas_target).subscribe({
      next: (res) => {
        this.downloadingPairKey = null;
        const dateStr = new Date().toISOString().slice(0, 10);
        const fallback = `${entry.dinas_inisiasi}-${entry.dinas_target}_${dateStr}.xlsx`;
        triggerBlobDownload(res.body!, filenameFromResponse(res.headers, fallback));
      },
      error: async (err) => {
        this.downloadingPairKey = null;
        await this.modal.alert('Gagal mengunduh: ' + (err?.message || err));
      },
    });
  }
}
