import { Component, OnInit } from '@angular/core';
import { ShareCostService, SplitCandidate } from '../services/share-cost.service';
import { DinasService, DinasEntry } from '../services/dinas.service';
import { ModalService } from '../services/modal.service';
import { ConfirmationService, triggerBlobDownload } from '../services/confirmation.service';
import { extractErrorMessage } from '../shared/error-message.util';

interface SplitRowVm {
  dinas_target: string;
  nominal: number | null;
}

// SRS section 3.10 (Share-Cost oleh TAB, "seadanya" version, asumsi dikunci 3 Agu): TAB pilih
// satu baris PENDING, input N baris split (dinas_target + nominal tiap baris), validasi sum
// real-time sebelum submit. Lives under Need Identification's sub-nav (shell.component.html).
@Component({
  selector: 'rdt-share-cost',
  standalone: false,
  templateUrl: './share-cost.component.html',
  styleUrls: ['./share-cost.component.scss'],
})
export class ShareCostComponent implements OnInit {
  query = '';
  candidates: SplitCandidate[] = [];
  dinasOptions: DinasEntry[] = [];
  loading = false;
  errorMessage = '';

  selected: SplitCandidate | null = null;
  splitRows: SplitRowVm[] = [];
  note = '';
  submitting = false;

  constructor(
    private shareCost: ShareCostService,
    private dinasService: DinasService,
    private modal: ModalService,
    private confirmation: ConfirmationService,
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
    // Start with 2 blank rows — the original's own (dinas_target, nominal) is a natural first
    // guess for one of them, matching the SRS example (TH keeps 35rb of its original 100rb).
    this.splitRows = [
      { dinas_target: row.dinas_target, nominal: null },
      { dinas_target: '', nominal: null },
    ];
    this.note = '';
  }

  // REQ-RDT-LEDGER-09, extended 5 Agu ke Share-Cost -- satu baris candidate = satu upload asal,
  // jadi cukup langsung dari `selected`, tidak perlu dedupe seperti antrian PENDING/Investigation.
  downloadOriginal(): void {
    if (!this.selected) return;
    const uploadId = this.selected.upload_id;
    const filename = this.selected.upload_filename || `upload-${uploadId}.xlsx`;
    this.confirmation.downloadOriginal(uploadId, filename).subscribe({
      next: (blob) => triggerBlobDownload(blob, filename),
      error: async (err) => { await this.modal.alert('Gagal mengunduh file asli: ' + extractErrorMessage(err, String(err))); },
    });
  }

  cancelSelection(): void {
    this.selected = null;
    this.splitRows = [];
    this.note = '';
  }

  addSplitRow(): void {
    this.splitRows.push({ dinas_target: '', nominal: null });
  }

  removeSplitRow(index: number): void {
    if (this.splitRows.length <= 2) return;
    this.splitRows.splice(index, 1);
  }

  get sumNominal(): number {
    return this.splitRows.reduce((acc, r) => acc + (r.nominal || 0), 0);
  }

  get sumDiff(): number {
    if (!this.selected) return 0;
    return Math.round((this.sumNominal - this.selected.nominal) * 100) / 100;
  }

  get sumMatches(): boolean {
    return this.sumDiff === 0;
  }

  canSubmit(): boolean {
    if (!this.selected || this.submitting) return false;
    if (!this.note.trim()) return false;
    if (this.splitRows.length < 2) return false;
    if (!this.sumMatches) return false;
    return this.splitRows.every((r) => !!r.dinas_target && typeof r.nominal === 'number' && r.nominal !== 0);
  }

  async submit(): Promise<void> {
    if (!this.selected || !this.canSubmit()) return;
    const ok = await this.modal.confirm(
      `Split baris ${this.selected.account} (${this.selected.nominal}) jadi ${this.splitRows.length} baris? Baris asli akan ditandai SPLIT_VOID dan tidak bisa dikembalikan.`
    );
    if (!ok) return;
    this.submitting = true;
    const splits = this.splitRows.map((r) => ({ dinas_target: r.dinas_target, nominal: r.nominal as number }));
    this.shareCost.split(this.selected.id, splits, this.note.trim()).subscribe({
      next: async () => {
        this.submitting = false;
        await this.modal.success(`Baris berhasil di-split jadi ${splits.length} baris baru.`);
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
