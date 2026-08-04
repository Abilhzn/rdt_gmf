import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { TransactionService, ContractField } from '../../services/transaction.service';
import { Transaction, TransactionStatus, AggregationMatrix } from '../../services/transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ModalService } from '../../services/modal.service';
import { matchesAllColumnFilters } from '../../shared/multi-value-filter.component';

type UiPhase = 'idle' | 'parsing' | 'parsed' | 'committing' | 'committed' | 'error';

interface PreviewColumn {
  key: string;
  label: string;
  /** true for the one contract field (In PCLC) rendered via the specially-formatted Nominal
   * cell instead of a plain text cell — see the template's *ngSwitchCase. */
  numeric?: boolean;
}

@Component({
  selector: 'app-repost-budgeting',
  standalone: false,
  templateUrl: './repost-budgeting.component.html',
  styleUrls: ['./repost-budgeting.component.scss'],
})
export class RepostBudgetingComponent implements OnInit, OnDestroy {
  phase: UiPhase = 'idle';
  errorMessage = '';

  selectedFile: File | null = null;
  isDragOver = false;
  /** item 6: optional free-text note attached to the upload record, not a required field */
  description = '';
  /** REQ-RDT-SAP-13 (3 Agu): which month/year this DT is FOR — REQUIRED, never inferred from the
   * upload/repost timestamp (that inference is exactly the bug this requirement fixes: a June DT
   * re-posted in August used to archive under August). "YYYY-MM" from an <input type="month">. */
  period = '';

  rows: Transaction[] = [];
  aggregation: AggregationMatrix = {};

  /** filter state */
  statusFilter: TransactionStatus | 'ALL' = 'ALL';
  dinasFilter = 'ALL';
  searchText = '';
  /** REQ-RDT-NAV-09 (diperluas 1 Agu): satu filter multi-value per KOLOM, bukan cuma Account —
   * keyed by PreviewColumn.key, AND antar kolom aktif, OR di dalam satu kolom (lihat
   * matchesAllColumnFilters). */
  columnFilters: Record<string, string[]> = {};

  /** REQ-RDT-NAV-04 (1 Agu): kolom preview HARUS sama persis dengan yang ikut ter-repost — satu
   * sumber (CONTRACT_FIELDS, via GET /api/contract-fields) dipakai bareng oleh preview ini dan
   * proses export sebenarnya (exportBatches.js), bukan di-hardcode terpisah. In PCLC dirender
   * lewat kolom "Nominal" yang sudah ada (format angka + highlight negatif) di posisi yang sama,
   * bukan dua kolom terpisah untuk nilai yang sama. */
  contractFields: ContractField[] = [];
  previewColumns: PreviewColumn[] = [];

  /** REQ-RDT-NAV-07: pagination sederhana client-side, 100 baris/halaman, pager reusable
   * (shared/pagination.component.ts) yang juga dipakai di Confirmation. */
  page = 1;
  readonly pageSize = 100;

  private userSub?: Subscription;
  private isFirstUserEmission = true;

  constructor(
    private txService: TransactionService,
    public currentUser: CurrentUserService,
    private modal: ModalService,
  ) {
    this.txService.getContractFields().subscribe((fields) => {
      this.contractFields = fields;
      this.previewColumns = this.buildPreviewColumns(fields);
    });
  }

  // REQ-RDT-NAV-04: Sub Group leftmost, then EVERY contract field in its contract order (In PCLC
  // swapped for the specially-formatted Nominal cell at that same position — see
  // PreviewColumn.numeric), then the existing operational columns (Dinas target/Kategori/Status),
  // Remark, and finally Catatan Reviewer.
  // REQ-RDT-UI-08 (4 Agu): Sheet/Baris (raw_row_index) dropped — technical parser metadata, not
  // real DT data, not useful to the reviewing user.
  private buildPreviewColumns(fields: ContractField[]): PreviewColumn[] {
    const contractCols: PreviewColumn[] = fields.map((f) =>
      f.key === 'in_pclc' ? { key: 'in_pclc', label: 'Nominal', numeric: true } : { key: f.key, label: f.label },
    );
    return [
      { key: 'sub_group', label: 'Sub Group' },
      ...contractCols,
      { key: 'dinas_target', label: 'Dinas target' },
      { key: 'category', label: 'Kategori' },
      { key: 'status_konfirmasi', label: 'Status' },
      { key: 'remark', label: 'Remark' },
    ];
  }

  // Generic accessor so the template can read any PreviewColumn.key off a row without a giant
  // *ngSwitch — every contract field is already a top-level property on the parsed row (see
  // excelParser.js's buildDetailRow), same object, no per-column special-casing needed here.
  getCellValue(row: Transaction, key: string): string | number | null | undefined {
    return (row as unknown as Record<string, string | number | null | undefined>)[key];
  }

  onColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.columnFilters[key] = values;
    else delete this.columnFilters[key];
    this.onFilterChange();
  }

  ngOnInit(): void {
    // Item 3: switching "Login sebagai" must not leave one user's parsed rows/description/
    // success state visible to whoever logs in next — reset whenever the account changes.
    // Skip the very first emission (component's own initial load) so this doesn't clobber
    // anything before the user has done anything.
    this.userSub = this.currentUser.user$.subscribe(() => {
      if (this.isFirstUserEmission) { this.isFirstUserEmission = false; return; }
      this.reset();
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  // ---------- file selection ----------
  onFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) this.setFile(input.files[0]);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = false;
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.setFile(f);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  private setFile(f: File): void {
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      this.phase = 'error';
      this.errorMessage = 'Format file harus .xlsx. File yang dipilih: ' + f.name;
      return;
    }
    this.selectedFile = f;
    this.phase = 'idle';
    this.errorMessage = '';
  }

  // ---------- actions ----------
  parse(): void {
    if (!this.selectedFile) return;
    this.phase = 'parsing';
    this.errorMessage = '';
    this.txService
      .uploadAndParse(this.selectedFile)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            this.phase = 'error';
            this.errorMessage = res.error || 'Parse gagal tanpa pesan error.';
            return;
          }
          this.rows = res.rows || [];
          this.aggregation = res.aggregation || {};
          this.page = 1;
          this.phase = 'parsed';
        },
        error: (err) => {
          this.phase = 'error';
          this.errorMessage = err?.error?.error || err?.message || 'Gagal menghubungi server.';
        },
      });
  }

  commit(): void {
    if (!this.rows.length || !this.period) return;
    this.phase = 'committing';
    // REQ-RDT-NAV-04: reviewer_note is frontend-only (see transaction.model.ts) — strip it before
    // persisting so it's unambiguous nothing gets silently sent/stored server-side.
    const rowsToPersist = this.rows.map(({ reviewer_note, ...rest }) => rest);
    this.txService
      .persistToDatabase(rowsToPersist, this.aggregation, this.selectedFile, this.period, this.description)
      .subscribe({
        next: async (res) => {
          if (!res.ok) {
            this.phase = 'error';
            this.errorMessage = res.error || 'Simpan gagal tanpa pesan error.';
            return;
          }
          this.phase = 'committed';
          // Item 2: animated checkmark instead of an inline "Data tersimpan ke staging" line.
          // Item 3: reset right after, so this submitter's rows/file/description don't linger
          // on screen for whoever uses this browser session next.
          await this.modal.success('Repost berhasil diajukan!');
          this.reset();
        },
        error: (err) => {
          this.phase = 'error';
          this.errorMessage = err?.error?.error || err?.message || 'Gagal menyimpan ke staging.';
        },
      });
  }

  reset(): void {
    this.phase = 'idle';
    this.errorMessage = '';
    this.selectedFile = null;
    this.description = '';
    this.period = '';
    this.rows = [];
    this.aggregation = {};
    this.statusFilter = 'ALL';
    this.dinasFilter = 'ALL';
    this.searchText = '';
    this.columnFilters = {};
    this.page = 1;
  }

  // ---------- derived state untuk template ----------
  get statusCounts(): Record<string, number> {
    const c: Record<string, number> = { PENDING: 0, EXCLUDED: 0, INVALID: 0 };
    for (const r of this.rows) c[r.status_konfirmasi] = (c[r.status_konfirmasi] || 0) + 1;
    return c;
  }

  get aggregationCategories(): string[] {
    return Object.keys(this.aggregation).sort();
  }

  get aggregationDinasList(): string[] {
    const set = new Set<string>();
    Object.values(this.aggregation).forEach((byDinas) =>
      Object.keys(byDinas).forEach((d) => set.add(d)),
    );
    return Array.from(set).sort();
  }

  aggValue(category: string, dinas: string): number | null {
    const v = this.aggregation?.[category]?.[dinas];
    return typeof v === 'number' ? v : null;
  }

  get dinasOptions(): string[] {
    const set = new Set<string>();
    this.rows.forEach((r) => { if (r.dinas_target) set.add(r.dinas_target); });
    return Array.from(set).sort();
  }

  get filteredRows(): Transaction[] {
    const q = this.searchText.trim().toLowerCase();
    return this.rows.filter((r) => {
      if (this.statusFilter !== 'ALL' && r.status_konfirmasi !== this.statusFilter) return false;
      if (this.dinasFilter !== 'ALL' && r.dinas_target !== this.dinasFilter) return false;
      if (!matchesAllColumnFilters(r, this.columnFilters, (row, key) => this.getCellValue(row, key))) return false;
      if (q) {
        const hay = `${r.account || ''} ${r.remark || ''} ${r.category || ''} ${r.sheet || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  get pagedRows(): Transaction[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  onPageChange(p: number): void { this.page = p; }

  onFilterChange(): void { this.page = 1; }

  statusClass(s: TransactionStatus): string {
    return 'chip chip--' + s.toLowerCase();
  }

  trackByIndex(i: number): number { return i; }
}
