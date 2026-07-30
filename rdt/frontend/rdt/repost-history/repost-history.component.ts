import { Component, OnInit } from '@angular/core';
import { ExportBatchService, HistoryBatch } from '../services/export-batch.service';
import { triggerBlobDownload } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';
import { CurrentUserService } from '@auth/services/current-user.service';
import { matchesAnyFilterValue } from '../shared/multi-value-filter.component';

// REQ-RDT-SAP-10/12 "Riwayat Repost TAB/Dinas" — the archive destination for REQ-RDT-SAP-09 (a
// batch leaves Need Approval's "Sudah Confirmed" the instant it gets its first subdoc, see
// need-approval.component's addSubdoc). Also the in-app substitute for the deferred email
// notification (SMTP infra out of scope for now) — PICs already got their in-app notification +
// comment at Confirm time (POST /confirm), this page is a browsable log on top, not a
// replacement for that.
//
// SAP-12 (31 Jul, expanded): NOT TAB-only anymore — GET /history auto-scopes to the caller's own
// dinas_inisiasi for non-TAB users, TAB sees every dinas (see routes/exportBatches.js). Same
// endpoint, same table, two viewpoints — not a separate "Riwayat Repost Dinas" feature. Adding a
// subdoc and downloading the export file stay TAB-only actions (backend still gates those
// specifically), hidden here for a plain PIC.
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

  // REQ-RDT-SAP-11: subdoc entry is TAB-only and can be repeated on an already-archived batch
  // (splitting a large pair across several subdocs over time) — one input per batch row, keyed
  // by batch id since more than one row can be mid-entry at once.
  subdocInputByBatchId: Record<number, string> = {};
  addingSubdocBatchId: number | null = null;

  // REQ-RDT-NAV-09: paste-many-values filter on subdoc number — the page's own stated purpose
  // is "cari nomor refdoc/subdoc untuk cross-check", so that's the filterable column here
  // (batches don't have individual Account/Ref.Doc rows, unlike the other tables this applies to).
  subdocFilterValues: string[] = [];

  get filteredBatches(): HistoryBatch[] {
    if (!this.subdocFilterValues.length) return this.batches;
    return this.batches.filter((b) => b.subdoc_numbers.some((num) => matchesAnyFilterValue(num, this.subdocFilterValues)));
  }

  onSubdocFilterChange(values: string[]): void {
    this.subdocFilterValues = values;
  }

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
    public currentUser: CurrentUserService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  get isTab(): boolean {
    return this.currentUser.current?.role === 'TAB';
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

  // Defaults to covering every remaining unassigned line in the batch (see
  // routes/exportBatches.js's POST /:batchId/subdocs) — the common case where one subdoc covers
  // the whole pair. A dedicated line-picker for splitting a batch across several subdocs isn't
  // built here; TAB can still call the same endpoint with specific transaction_ids directly if
  // that's ever needed.
  async addSubdoc(batch: HistoryBatch): Promise<void> {
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
