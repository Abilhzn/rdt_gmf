import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { TransactionService, ContractField } from '../../services/transaction.service';
import { Transaction, TransactionStatus, AggregationMatrix } from '../../services/transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ModalService } from '../../services/modal.service';
import { matchesAllColumnFilters } from '../../shared/multi-value-filter.component';
import { extractErrorMessage } from '../../shared/error-message.util';

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

  rows: Transaction[] = [];
  aggregation: AggregationMatrix = {};

  /** filter state */
  statusFilter: TransactionStatus | 'ALL' = 'ALL';
  dinasFilter = 'ALL';
  /** searchText is what the input shows (updates instantly, keystroke-by-keystroke); the actual
   * table filtering reads debouncedSearchText, which only catches up 500ms after typing stops —
   * keeps the box responsive while avoiding a full table refilter/re-render on every keystroke. */
  searchText = '';
  debouncedSearchText = '';
  private readonly searchInput$ = new Subject<string>();
  /** Satu filter multi-value per KOLOM, bukan cuma Account — keyed by PreviewColumn.key, AND antar
   * kolom aktif, OR di dalam satu kolom (lihat matchesAllColumnFilters). */
  columnFilters: Record<string, string[]> = {};

  /** Kolom preview HARUS sama persis dengan yang ikut ter-repost — satu sumber (CONTRACT_FIELDS,
   * via GET /api/contract-fields) dipakai bareng oleh preview ini dan proses export sebenarnya,
   * bukan di-hardcode terpisah. In PCLC dirender lewat kolom "Nominal" yang sudah ada, bukan dua
   * kolom terpisah untuk nilai yang sama. */
  contractFields: ContractField[] = [];
  previewColumns: PreviewColumn[] = [];

  /** Pagination sederhana client-side, 50 baris/halaman, pager reusable
   * (shared/pagination.component.ts) yang juga dipakai di Confirmation. */
  page = 1;
  readonly pageSize = 50;

  private userSub?: Subscription;
  private searchSub?: Subscription;
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

  // Preview kolom dipersempit ke 11 kolom tetap + Notes, SAMA di setiap fitur preview (Repost,
  // Confirmation, transparansi Need Approval) — bukan "setiap kolom kontrak". CURATED_KEYS
  // difilter dari CONTRACT_FIELDS (bukan hardcode urutan manual) supaya kalau backend mengubah
  // urutan/label field, preview ikut. Ini TIDAK mengubah export ke SAP — file export tetap 53
  // kolom kontrak penuh, artifact terpisah. "Dinas target"/"Status" dipindah jadi kolom tetap
  // sendiri di luar previewColumns (lihat template), bukan dihapus.
  private static readonly CURATED_CONTRACT_KEYS = ['account', 'profit_ctr', 'ref_doc', 'period', 'text_desc', 'material', 'in_pclc'];
  private buildPreviewColumns(fields: ContractField[]): PreviewColumn[] {
    const contractCols: PreviewColumn[] = fields
      .filter((f) => RepostBudgetingComponent.CURATED_CONTRACT_KEYS.includes(f.key))
      .map((f) => f.key === 'in_pclc' ? { key: 'in_pclc', label: 'Value (In PCLC)', numeric: true } : { key: f.key, label: f.label });
    return [
      { key: 'dinas_inisiasi', label: 'Dinas Pengaju' },
      ...contractCols,
      { key: 'category', label: 'Group' },
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
    this.searchSub = this.searchInput$.pipe(debounceTime(500), distinctUntilChanged()).subscribe((q) => {
      this.debouncedSearchText = q;
      this.onFilterChange();
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
    this.searchSub?.unsubscribe();
  }

  onSearchInput(): void {
    this.searchInput$.next(this.searchText);
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
          this.errorMessage = extractErrorMessage(err, 'Gagal memproses file Excel.');
        },
      });
  }

  async commit(): Promise<void> {
    if (!this.rows.length) return;
    this.phase = 'committing';
    // reviewer_note persists as-is now (migration 015) — Confirmation's sticky "Notes" column
    // reads this same field. periode is not chosen here — the server derives it in POST /api/persist.
    this.txService
      .persistToDatabase(this.rows, this.aggregation, this.selectedFile, this.description)
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
          this.errorMessage = extractErrorMessage(err, 'Gagal menyimpan ke staging.');
        },
      });
  }

  reset(): void {
    this.phase = 'idle';
    this.errorMessage = '';
    this.selectedFile = null;
    this.description = '';
    this.rows = [];
    this.aggregation = {};
    this.statusFilter = 'ALL';
    this.dinasFilter = 'ALL';
    this.searchText = '';
    this.debouncedSearchText = '';
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
    const q = this.debouncedSearchText.trim().toLowerCase();
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
