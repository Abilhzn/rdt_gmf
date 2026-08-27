import { Component, OnInit } from '@angular/core';
import { ShareCostService, SplitCandidate, SplitLine } from '../services/share-cost.service';
import { DinasService, DinasEntry } from '../../../services/dinas.service';
import { ModalService } from '../../../services/modal.service';
import { OriginalFileDownloadService } from '../../../core/services/original-file-download.service';
import { triggerBlobDownload } from '../../../core/utils/blob-download.util';
import { extractErrorMessage } from '../../../core/utils/error-message.util';

// TAB pilih satu baris PENDING, input N baris split (dinas_target + nominal tiap baris), validasi
// sum real-time sebelum submit (see split-form.component.ts — dumb, owns the running-total
// validator). Lives under Need Identification's sub-nav (shell.component.html).
@Component({
  selector: 'app-share-cost-page',
  standalone: false,
  templateUrl: './share-cost-page.component.html',
  styleUrls: ['./share-cost-page.component.scss'],
})
export class ShareCostPageComponent implements OnInit {
  query = '';
  candidates: SplitCandidate[] = [];
  dinasOptions: DinasEntry[] = [];
  loading = false;
  errorMessage = '';

  selected: SplitCandidate | null = null;
  submitting = false;

  constructor(
    private shareCost: ShareCostService,
    private dinasService: DinasService,
    private modal: ModalService,
    private originalFile: OriginalFileDownloadService,
  ) {}

  ngOnInit(): void {
    this.dinasService.getActiveDinas().subscribe((d) => (this.dinasOptions = d));
    this.search();
  }

  search(): void {
    this.loading = true;
    this.errorMessage = '';
    this.shareCost.getCandidates(this.query).subscribe({
      next: (rows) => { this.candidates = rows; this.loading = false; },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat daftar baris'); this.loading = false; },
    });
  }

  selectRow(row: SplitCandidate): void {
    this.selected = row;
  }

  cancelSelection(): void {
    this.selected = null;
  }

  // Satu baris candidate = satu upload asal, jadi cukup langsung dari `selected`, tidak perlu
  // dedupe seperti antrian PENDING/Investigation.
  downloadOriginal(): void {
    if (!this.selected) return;
    const uploadId = this.selected.upload_id;
    const filename = this.selected.upload_filename || `upload-${uploadId}.xlsx`;
    this.originalFile.downloadOriginal(uploadId).subscribe({
      next: (blob) => triggerBlobDownload(blob, filename),
      error: async (err) => { await this.modal.alert('Gagal mengunduh file asli: ' + extractErrorMessage(err, String(err))); },
    });
  }

  async onSubmitSplit(payload: { splits: SplitLine[]; note: string }): Promise<void> {
    if (!this.selected) return;
    const ok = await this.modal.confirm(
      `Split baris ${this.selected.account} (${this.selected.nominal}) jadi ${payload.splits.length} baris? Baris asli akan ditandai SPLIT_VOID dan tidak bisa dikembalikan.`
    );
    if (!ok) return;
    this.submitting = true;
    this.shareCost.split(this.selected.id, payload.splits, payload.note).subscribe({
      next: async () => {
        this.submitting = false;
        await this.modal.success(`Baris berhasil di-split jadi ${payload.splits.length} baris baru.`);
        this.cancelSelection();
        this.search();
      },
      error: async (err) => {
        this.submitting = false;
        await this.modal.alert('Gagal menyimpan pembagian: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
