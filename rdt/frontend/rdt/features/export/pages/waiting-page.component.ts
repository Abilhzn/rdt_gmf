import { Component, OnInit } from '@angular/core';
import {
  ExportService,
  WaitingEntry,
  TransparencyRow,
} from '../services/export.service';
import { triggerBlobDownload, filenameFromResponse } from '../../../core/utils/blob-download.util';
import { ModalService } from '../../../services/modal.service';
import { extractErrorMessage } from '../../../shared/error-message.util';

// Approval unit is one PASANGAN (dinas_inisiasi, dinas_target): a WAITING entry appears (computed,
// not stored) once that specific pair is resolved — other pairs from the same dinas_inisiasi never
// block or get blocked by it. TAB can open full transparency for that one pair (including
// DECLINED/reassigned history), and can download the pair's Format TAB Excel directly off this
// list. Download doesn't wait for Confirm — it's one button per waiting entry.
// Confirm is ONE form (closing description + first subdoc number together, submitted in a single
// call): a batch is created WITH its first subdoc already attached, so it goes straight from this
// page's "Waiting" list into Riwayat Repost TAB.
@Component({
  selector: 'app-waiting-page',
  standalone: false,
  templateUrl: './waiting-page.component.html',
  styleUrls: ['./waiting-page.component.scss'],
})
export class WaitingPageComponent implements OnInit {
  waiting: WaitingEntry[] = [];
  errorMessage = '';
  // Skeleton while true; empty-state text gated on !loading so it's distinguishable from a
  // genuinely empty queue.
  loading = true;

  // Transparency + confirm form: at most one pair expanded at a time, keyed
  // "dinas_inisiasi dinas_target".
  expandedPairKey: string | null = null;
  transparencyRows: TransparencyRow[] = [];
  transparencyError = '';
  closingDescription = '';
  // A pair whose CONFIRMED rows exceed SAP's ~300-line cap downloads as several chunk-N.xlsx files
  // (exportBatches.js's streamContractExport) — one subdoc input per chunk, entered together here
  // ("Repost 1: [subdoc]", "Repost 2: [subdoc]", etc, see chunkCount/chunkIndexes below). A
  // non-chunked pair gets a single-input experience (array of length 1).
  subdocNumbers: string[] = [''];
  confirming = false;

  // Per-entry download-in-progress flag (waiting list, keyed by pairKey) — separate from
  // `confirming` above, which only applies to the expanded transparency panel's form.
  downloadingPairKey: string | null = null;

  constructor(
    private exportBatches: ExportService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.errorMessage = '';
    this.loading = true;
    this.exportBatches.getWaiting().subscribe({
      next: (waiting) => { this.waiting = waiting; this.loading = false; },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat antrian'); this.loading = false; },
    });
  }

  pairKey(dinasInisiasi: string, dinasTarget: string): string {
    return `${dinasInisiasi} ${dinasTarget}`;
  }

  openTransparency(dinasInisiasi: string, dinasTarget: string): void {
    this.expandedPairKey = this.pairKey(dinasInisiasi, dinasTarget);
    this.transparencyError = '';
    this.closingDescription = '';
    this.subdocNumbers = [''];
    this.transparencyRows = [];
    this.exportBatches.getTransparency(dinasInisiasi, dinasTarget).subscribe({
      next: (rows) => {
        this.transparencyRows = rows;
        // Chunk count is only knowable once the actual row set (and how many are CONFIRMED,
        // the only status that ends up in a downloaded chunk) has loaded — resize the input
        // array to match now that it has.
        this.subdocNumbers = new Array(this.chunkCount).fill('');
      },
      error: (err) => { this.transparencyError = extractErrorMessage(err, 'Gagal memuat transparansi'); },
    });
  }

  // MAX_ROWS_PER_FILE in exportBatches.js — kept in sync manually (small, stable constant, not
  // worth a round-trip just to fetch a number). Public: the template shows it in the chunked-pair
  // hint text ("X baris/file").
  readonly maxRowsPerFile = 300;

  // Only CONFIRMED rows actually end up in a downloaded chunk (streamContractExport's own filter)
  // — BORNE_BY_INITIATOR rows are attachable/confirmable but never exported, so they must NOT
  // count toward chunk boundaries or a subdoc's transaction_ids here. Already `ORDER BY id` from
  // the backend, same order the export endpoints use, so chunking this client-side reproduces the
  // exact same chunk-N boundaries TAB downloaded and posted to SAP.
  get confirmedTransparencyRows(): TransparencyRow[] {
    return this.transparencyRows.filter((r) => r.status_konfirmasi === 'CONFIRMED');
  }

  get chunkCount(): number {
    return Math.max(1, Math.ceil(this.confirmedTransparencyRows.length / this.maxRowsPerFile));
  }

  get chunkIndexes(): number[] {
    return Array.from({ length: this.chunkCount }, (_, i) => i + 1);
  }

  private chunkTransactionIds(chunkNumber1Based: number): number[] {
    const start = (chunkNumber1Based - 1) * this.maxRowsPerFile;
    return this.confirmedTransparencyRows.slice(start, start + this.maxRowsPerFile).map((r) => r.id);
  }

  closeTransparency(): void {
    this.expandedPairKey = null;
    this.transparencyRows = [];
  }

  // Confirm requires every subdoc number — one per chunk (see subdocNumbers/chunkCount above).
  // Closing description is optional, TAB can confirm with the field left blank.
  canConfirm(): boolean {
    return this.subdocNumbers.every((s) => !!s.trim());
  }

  // Chunk 1's subdoc is attached atomically with the batch itself (POST /confirm) — chunk 2+ each
  // need their own POST /:batchId/subdocs call AFTER the batch exists, sequentially (not parallel
  // — each call's `transaction_ids` must be a subset of rows NOT YET covered by an earlier subdoc,
  // so they have to land in order). If a later chunk's call fails, the batch and any earlier
  // chunks it already got ARE still confirmed/saved — reload and say plainly which chunk failed.
  async confirmPair(dinasInisiasi: string, dinasTarget: string): Promise<void> {
    if (!this.canConfirm()) return;
    const chunkLabel = this.chunkCount > 1 ? ` (${this.chunkCount} subdoc)` : ` dengan subdoc ${this.subdocNumbers[0].trim()}`;
    const ok = await this.modal.confirm(`Confirm repost ${dinasInisiasi} → ${dinasTarget}${chunkLabel}? Aksi ini tidak bisa dibatalkan.`);
    if (!ok) return;
    this.confirming = true;
    const firstChunkIds = this.chunkTransactionIds(1);
    this.exportBatches.confirm(dinasInisiasi, dinasTarget, this.closingDescription.trim(), this.subdocNumbers[0].trim(), firstChunkIds).subscribe({
      next: async (result) => {
        const batchId = result.batch_id;
        for (let chunk = 2; chunk <= this.chunkCount; chunk++) {
          try {
            await new Promise<void>((resolve, reject) => {
              this.exportBatches.addSubdoc(batchId, this.subdocNumbers[chunk - 1].trim(), this.chunkTransactionIds(chunk)).subscribe({
                next: () => resolve(),
                error: (err) => reject(err),
              });
            });
          } catch (err: unknown) {
            this.confirming = false;
            await this.modal.alert(`Batch sudah tersimpan dengan ${chunk - 1} subdoc, tapi subdoc chunk ${chunk} gagal disimpan: ${extractErrorMessage(err, String(err))}. Tambahkan sisanya dari TAB Repost History.`);
            this.closeTransparency();
            this.load();
            return;
          }
        }
        this.confirming = false;
        await this.modal.success(`Repost ${dinasInisiasi} → ${dinasTarget} sudah dikonfirmasi dan tercatat di TAB Repost History.`);
        this.closeTransparency();
        this.load();
      },
      error: async (err) => {
        this.confirming = false;
        await this.modal.alert('Gagal mengonfirmasi repost: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  // Download is available the instant a pair shows up here — no batch/Confirm needed first. Reads
  // directly off the pair's still-unbatched CONFIRMED rows, mapped to the official 8-column Format
  // TAB sheet (Requester/Cost.Element/Amount/Curr./Recipient/Qty/UoM/Text) — the only format now
  // (REQ-RDT-SAP-06 diganti total, 15 Agu: full-53-column download removed, Format TAB is enough
  // since SAP already has the full detail, repost is just an ownership transfer). >300 rows comes
  // back as a .zip instead of .xlsx — the actual filename comes from the response.
  download(entry: WaitingEntry): void {
    const key = this.pairKey(entry.dinas_inisiasi, entry.dinas_target);
    this.downloadingPairKey = key;
    this.exportBatches.getExportPair(entry.dinas_inisiasi, entry.dinas_target).subscribe({
      next: (res) => {
        this.downloadingPairKey = null;
        const dateStr = new Date().toISOString().slice(0, 10);
        const fallback = `${entry.dinas_inisiasi}-${entry.dinas_target}_${dateStr}_FormatTAB.xlsx`;
        triggerBlobDownload(res.body!, filenameFromResponse(res.headers, fallback));
      },
      error: async (err) => {
        this.downloadingPairKey = null;
        await this.modal.alert('Gagal mengunduh: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
