import { Component, OnInit } from '@angular/core';
import {
  ExportBatchService,
  WaitingEntry,
  TransparencyRow,
} from '../services/export-batch.service';
import { triggerBlobDownload, filenameFromResponse } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

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
  // Audit "kaku" 17 Agu: this page had NO loading flag at all — "Belum ada pasangan yang siap
  // di-repost" showed immediately on every load, indistinguishable from genuinely empty. Same
  // gap the 12 Agu loading-state checklist already fixed elsewhere (home/repost-history), just
  // missed here — fixed the same way (skeleton while true, empty-state text gated on !loading).
  loading = true;

  // Transparency + confirm form: at most one pair expanded at a time, keyed
  // "dinas_inisiasi dinas_target".
  expandedPairKey: string | null = null;
  transparencyRows: TransparencyRow[] = [];
  transparencyError = '';
  closingDescription = '';
  // REQ-RDT-SAP-08/11 REVISI (5 Agu, project owner request): a pair whose CONFIRMED rows exceed
  // SAP's ~300-line cap downloads as several chunk-N.xlsx files (see exportBatches.js's
  // streamContractExport) — this used to mean ONE subdoc input here (covering chunk 1 only) and a
  // separate trip to Riwayat Repost TAB's "+ Tambah subdoc" for chunk 2+ later. Now it's ONE
  // array, sized to the actual chunk count, entered together right here — "Repost 1: [subdoc]",
  // "Repost 2: [subdoc]", etc. (see chunkCount/chunkIndexes below). A non-chunked pair keeps
  // exactly the old single-input experience (array of length 1, same label).
  subdocNumbers: string[] = [''];
  confirming = false;

  // Per-entry download-in-progress flag (waiting list, keyed by pairKey) — separate from
  // `confirming` above, which only applies to the expanded transparency panel's form.
  downloadingPairKey: string | null = null;

  constructor(
    private exportBatches: ExportBatchService,
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

  // Only CONFIRMED rows actually end up in a downloaded chunk (streamContractExport's own filter,
  // REQ-RDT-SAP-06) — BORNE_BY_INITIATOR rows are attachable/confirmable but never exported as a
  // file line, so they must NOT count toward chunk boundaries or a subdoc's transaction_ids here.
  // Already `ORDER BY id` from the backend (GET /transparency), same order the export endpoints
  // use, so chunking this client-side reproduces the exact same chunk-N boundaries TAB just
  // downloaded and posted to SAP.
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

  // REQ-RDT-SAP-05 (revised): Confirm requires every subdoc number — one per chunk (see
  // subdocNumbers/chunkCount above). Project owner request (12 Agu): closing description is no
  // longer part of this gate — it flipped from mandatory to optional (see
  // exportBatches.js POST /confirm's own header comment), TAB can confirm with the field left
  // blank.
  canConfirm(): boolean {
    return this.subdocNumbers.every((s) => !!s.trim());
  }

  // REQ-RDT-SAP-08/11 REVISI (5 Agu): chunk 1's subdoc is attached atomically with the batch
  // itself (POST /confirm, unchanged) — chunk 2+ each need their own POST /:batchId/subdocs call
  // AFTER the batch exists, so those go out sequentially (not parallel — each call's `transaction_
  // ids` must be a subset of rows NOT YET covered by an earlier subdoc, per the backend's own
  // defensive check, so they have to land in order). If a later chunk's call fails, the batch and
  // any earlier chunks it already got ARE still confirmed/saved — reload so the list reflects
  // that instead of silently pretending nothing happened, and say plainly which chunk failed.
  async confirmPair(dinasInisiasi: string, dinasTarget: string): Promise<void> {
    if (!this.canConfirm()) return;
    const chunkLabel = this.chunkCount > 1 ? ` (${this.chunkCount} subdoc)` : ` dengan subdoc ${this.subdocNumbers[0].trim()}`;
    const ok = await this.modal.confirm(`Confirm repost ${dinasInisiasi} → ${dinasTarget}${chunkLabel}? Aksi ini tidak bisa dibatalkan.`);
    if (!ok) return;
    this.confirming = true;
    const firstChunkIds = this.chunkTransactionIds(1);
    this.exportBatches.confirm(dinasInisiasi, dinasTarget, this.closingDescription.trim(), this.subdocNumbers[0].trim(), firstChunkIds).subscribe({
      next: async (batchId) => {
        for (let chunk = 2; chunk <= this.chunkCount; chunk++) {
          try {
            await new Promise<void>((resolve, reject) => {
              this.exportBatches.addSubdoc(batchId, this.subdocNumbers[chunk - 1].trim(), this.chunkTransactionIds(chunk)).subscribe({
                next: () => resolve(),
                error: (err) => reject(err),
              });
            });
          } catch (err: any) {
            this.confirming = false;
            await this.modal.alert(`Batch sudah tersimpan dengan ${chunk - 1} subdoc, tapi subdoc chunk ${chunk} gagal disimpan: ${extractErrorMessage(err, String(err))}. Tambahkan sisanya dari Riwayat Repost TAB.`);
            this.closeTransparency();
            this.load();
            return;
          }
        }
        this.confirming = false;
        await this.modal.success(`Repost ${dinasInisiasi} → ${dinasTarget} sudah dikonfirmasi dan tercatat di Riwayat Repost TAB.`);
        this.closeTransparency();
        this.load();
      },
      error: async (err) => {
        this.confirming = false;
        await this.modal.alert('Gagal mengonfirmasi repost: ' + extractErrorMessage(err, String(err)));
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
        await this.modal.alert('Gagal mengunduh: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
