import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Transaction, TransactionStatus } from '../../../shared/models/transaction.model';
import { matchesAllColumnFilters } from '../../../shared/multi-value-filter.component';

interface PreviewColumn {
  key: string;
  label: string;
  /** rendered via the numeric "Nominal" cell (backed by `row.nominal`) instead of a plain text
   * cell — see the template's *ngIf. */
  numeric?: boolean;
}

/** Format CBO's 12 columns are fixed — no more `GET /api/contract-fields` (53-column contract is
 * gone), so this is hardcoded instead of fetched. Curated to the same 7 + dinas + category +
 * remark subset the old preview used (`repost-budgeting.component.ts`'s CURATED_CONTRACT_KEYS). */
const PREVIEW_COLUMNS: PreviewColumn[] = [
  { key: 'dinas_inisiasi', label: 'Dinas Pengaju' },
  { key: 'account', label: 'Account' },
  { key: 'profit_ctr', label: 'Profit Ctr' },
  { key: 'ref_doc', label: 'Ref.Doc.' },
  { key: 'period', label: 'Period' },
  { key: 'text_desc', label: 'Text' },
  { key: 'material', label: 'Material' },
  { key: 'in_pclc', label: 'Value (In PCLC)', numeric: true },
  { key: 'category', label: 'Group' },
  { key: 'remark', label: 'Remark' },
];

/** Dumb (no HTTP): filter/search/paginate + render the parsed-rows preview table, with per-row
 * editable "Catatan Reviewer" (mutates `reviewer_note` in place via two-way binding on the same
 * row objects the parent owns — no output needed for that, same as the original component). */
@Component({
  selector: 'rdt-preview-table',
  standalone: false,
  templateUrl: './preview-table.component.html',
})
export class PreviewTableComponent implements OnInit, OnDestroy {
  @Input() rows: Transaction[] = [];

  readonly previewColumns = PREVIEW_COLUMNS;

  statusFilter: TransactionStatus | 'ALL' = 'ALL';
  dinasFilter = 'ALL';
  searchText = '';
  debouncedSearchText = '';
  private readonly searchInput$ = new Subject<string>();
  private searchSub?: Subscription;

  /** Satu filter multi-value per kolom, keyed by PreviewColumn.key — AND antar kolom, OR di dalam
   * satu kolom (lihat matchesAllColumnFilters). */
  columnFilters: Record<string, string[]> = {};

  page = 1;
  readonly pageSize = 50;

  ngOnInit(): void {
    this.searchSub = this.searchInput$.pipe(debounceTime(500), distinctUntilChanged()).subscribe((q) => {
      this.debouncedSearchText = q;
      this.onFilterChange();
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  onSearchInput(): void {
    this.searchInput$.next(this.searchText);
  }

  onColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.columnFilters[key] = values;
    else delete this.columnFilters[key];
    this.onFilterChange();
  }

  onFilterChange(): void {
    this.page = 1;
  }

  onPageChange(p: number): void {
    this.page = p;
  }

  getCellValue(row: Transaction, key: string): string | number | null | undefined {
    return (row as unknown as Record<string, string | number | null | undefined>)[key];
  }

  get statusCounts(): Record<string, number> {
    const c: Record<string, number> = { PENDING: 0, EXCLUDED: 0, INVALID: 0, NEEDS_REVIEW: 0, NEEDS_INVESTIGATION: 0 };
    for (const r of this.rows) c[r.status_konfirmasi] = (c[r.status_konfirmasi] || 0) + 1;
    return c;
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

  trackByIndex(i: number): number {
    return i;
  }

  statusClass(s: TransactionStatus): string {
    return 'chip chip--' + s.toLowerCase();
  }
}
