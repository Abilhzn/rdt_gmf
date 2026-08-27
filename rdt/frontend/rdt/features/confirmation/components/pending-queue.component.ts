import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { PendingRow } from '../services/confirmation.service';
import { DinasEntry } from '../../../services/dinas.service';
import { matchesAllColumnFilters } from '../../../shared/multi-value-filter.component';

export interface PendingRowVm extends PendingRow {
  checked: boolean;
  /** '' = balik ke pengaju (default DECLINED flow); a dinas code = reject-and-redirect there
   * immediately. Only meaningful when checked=false. */
  redirectTo: string;
}

export interface PreviewColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

/** Dumb: the PENDING queue table — checkbox confirm/decline, per-row redirect picker, chain
 * breadcrumb popover, column filters, pagination, per-upload "download original" buttons. No
 * HTTP — `rows` mutated in place via two-way binding on `checked`/`redirectTo` (same pattern as
 * Repost Review's `reviewer_note`, Batch 6b) so the parent just reads `rows` back on submit. */
@Component({
  selector: 'rdt-pending-queue',
  standalone: false,
  templateUrl: './pending-queue.component.html',
})
export class PendingQueueComponent {
  @Input() rows: PendingRowVm[] = [];
  @Input() previewColumns: PreviewColumn[] = [];
  @Input() dinasOptions: DinasEntry[] = [];
  @Input() selectedTarget = '';
  @Output() downloadOriginal = new EventEmitter<{ uploadId: number; filename: string }>();

  page = 1;
  readonly pageSize = 50;
  columnFilters: Record<string, string[]> = {};

  /** At most one chain popover open at a time. A table cell has no room to widen sideways like the
   * Dashboard cards do, so this opens a small floating popover instead, positioned from the
   * trigger button's bounding rect (position:fixed — position:absolute would get clipped by
   * .table-scroll's `overflow-x: auto`, which forces overflow-y to a clipping value too). */
  expandedChainRowId: number | null = null;
  chainPopoverTop = 0;
  chainPopoverLeft = 0;

  @HostListener('document:click')
  onDocumentClick(): void {
    this.expandedChainRowId = null;
  }

  isChainPopoverOpen(rowId: number): boolean {
    return this.expandedChainRowId === rowId;
  }

  toggleChainPopover(event: MouseEvent, rowId: number): void {
    event.stopPropagation();
    const opening = this.expandedChainRowId !== rowId;
    this.expandedChainRowId = opening ? rowId : null;
    if (opening) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.chainPopoverTop = rect.bottom + 4;
      this.chainPopoverLeft = rect.left;
    }
  }

  getCellValue(row: PendingRowVm, key: string): string | number | null | undefined {
    return row[key] as string | number | null | undefined;
  }

  // Dinas choices for a pending row's "reject ke dinas lain" picker — can't send back to the
  // uploader, can't redirect to the rejecting dinas itself (same exclusion rules as REASSIGN).
  redirectTargetsFor(row: PendingRow): DinasEntry[] {
    const excluded = new Set([String(row.dinas_inisiasi || '').toUpperCase(), this.selectedTarget.toUpperCase()]);
    return this.dinasOptions.filter((d) => !excluded.has(d.code.toUpperCase()));
  }

  toggleSelectAll(checked: boolean): void {
    this.rows.forEach((r) => (r.checked = checked));
  }

  get hasActiveFilter(): boolean {
    return Object.keys(this.columnFilters).length > 0;
  }

  toggleSelectAllFiltered(checked: boolean): void {
    this.filteredRows.forEach((r) => (r.checked = checked));
  }

  onColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.columnFilters[key] = values;
    else delete this.columnFilters[key];
    this.page = 1;
  }

  get filteredRows(): PendingRowVm[] {
    return this.rows.filter((r) => matchesAllColumnFilters(r, this.columnFilters, (row, key) => this.getCellValue(row, key)));
  }

  get pagedRows(): PendingRowVm[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  onPageChange(p: number): void {
    this.page = p;
  }

  // One download button per distinct source upload feeding this queue — one confirmation pair can
  // be fed by more than one upload (different months/periods). Dedupes upload_id/upload_filename
  // already carried by the rows, no separate "list available files" endpoint needed.
  get downloadableUploads(): { upload_id: number; upload_filename: string }[] {
    const seen = new Map<number, { upload_id: number; upload_filename: string }>();
    for (const r of this.rows) {
      if (r.upload_id != null && !seen.has(r.upload_id)) {
        seen.set(r.upload_id, { upload_id: r.upload_id, upload_filename: r.upload_filename || `upload-${r.upload_id}.xlsx` });
      }
    }
    return Array.from(seen.values());
  }
}
