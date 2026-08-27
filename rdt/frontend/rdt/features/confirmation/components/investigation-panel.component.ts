import { Component, EventEmitter, Input, Output } from '@angular/core';
import { InvestigationRow, InvestigationService } from '../services/investigation.service';
import { DinasEntry } from '../../../services/dinas.service';
import { ModalService } from '../../../services/modal.service';
import { extractErrorMessage } from '../../../core/utils/error-message.util';
import { matchesAllColumnFilters } from '../../../shared/multi-value-filter.component';

/** TAB-only Investigation/Ask TA panel — assign a NEEDS_INVESTIGATION row's real dinas_target
 * (final, straight to CONFIRMED, no re-confirmation from the target). Owns its own HTTP
 * (InvestigationService) for the write actions (assign/assign-all/bulk-assign); `rows` itself is
 * still fetched by the parent page (so "Muat ulang antrian" and the initial load share one path)
 * and passed in as `@Input`. Emits `changed` after any successful write so the parent refetches. */
@Component({
  selector: 'rdt-investigation-panel',
  standalone: false,
  templateUrl: './investigation-panel.component.html',
})
export class InvestigationPanelComponent {
  @Input() rows: InvestigationRow[] = [];
  @Input() dinasOptions: DinasEntry[] = [];
  @Output() changed = new EventEmitter<void>();
  @Output() reload = new EventEmitter<void>();
  @Output() downloadOriginal = new EventEmitter<{ uploadId: number; filename: string }>();

  description = '';
  columnFilters: Record<string, string[]> = {};
  targetByRowId: Record<number, string> = {};
  selectedIds = new Set<number>();
  bulkTargetDinas = '';

  assigningRowId: number | null = null;
  assigningAll = false;
  bulkAssigning = false;

  constructor(private investigation: InvestigationService, private modal: ModalService) {}

  private getCellValue(row: InvestigationRow, key: string): string | number | null | undefined {
    return (row as unknown as Record<string, string | number | null | undefined>)[key];
  }

  get filteredRows(): InvestigationRow[] {
    return this.rows.filter((r) => matchesAllColumnFilters(r, this.columnFilters, (row, key) => this.getCellValue(row, key)));
  }

  onColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.columnFilters[key] = values;
    else delete this.columnFilters[key];
  }

  dinasOptionsFor(row: InvestigationRow): DinasEntry[] {
    return this.dinasOptions.filter((d) => d.code.toUpperCase() !== String(row.dinas_inisiasi || '').toUpperCase());
  }

  get downloadableUploads(): { upload_id: number; upload_filename: string }[] {
    const seen = new Map<number, { upload_id: number; upload_filename: string }>();
    for (const r of this.rows) {
      if (r.upload_id != null && !seen.has(r.upload_id)) {
        seen.set(r.upload_id, { upload_id: r.upload_id, upload_filename: r.upload_filename || `upload-${r.upload_id}.xlsx` });
      }
    }
    return Array.from(seen.values());
  }

  async assign(row: InvestigationRow): Promise<void> {
    const target = this.targetByRowId[row.id];
    if (!target) { await this.modal.alert('Pilih dinas target dulu.'); return; }
    const ok = await this.modal.confirm(`Assign baris ini ke dinas ${target}? Aksi ini FINAL — baris LANGSUNG berstatus Confirmed, dinas target tidak perlu konfirmasi ulang.`);
    if (!ok) return;
    const description = this.description.trim() || undefined;
    this.assigningRowId = row.id;
    this.investigation.assign(row.id, target, description).subscribe({
      next: async (dinasTarget) => {
        this.assigningRowId = null;
        await this.modal.success('Baris di-assign ke ' + dinasTarget);
        this.changed.emit();
      },
      error: async (err) => { this.assigningRowId = null; await this.modal.alert('Gagal menetapkan dinas: ' + extractErrorMessage(err, String(err))); },
    });
  }

  // Same "must decide EVERY row before you can batch" gate the backend independently enforces.
  canAssignAll(): boolean {
    return this.rows.length > 0 && this.rows.every((r) => !!this.targetByRowId[r.id]);
  }

  async assignAll(): Promise<void> {
    if (!this.canAssignAll()) return;
    const ok = await this.modal.confirm(`Assign ${this.rows.length} baris sekaligus ke dinas yang sudah dipilih masing-masing? Aksi ini FINAL — semua baris LANGSUNG berstatus Confirmed.`);
    if (!ok) return;
    const items = this.rows.map((r) => ({ transaction_id: r.id, dinas_target: this.targetByRowId[r.id] }));
    const description = this.description.trim() || undefined;
    this.assigningAll = true;
    this.investigation.assignAll(items, description).subscribe({
      next: async () => {
        this.assigningAll = false;
        await this.modal.success('Semua baris sudah di-assign');
        this.changed.emit();
      },
      error: async (err) => { this.assigningAll = false; await this.modal.alert('Gagal menetapkan dinas untuk semua baris: ' + extractErrorMessage(err, String(err))); },
    });
  }

  isSelected(rowId: number): boolean {
    return this.selectedIds.has(rowId);
  }

  toggleSelection(rowId: number, checked: boolean): void {
    if (checked) this.selectedIds.add(rowId);
    else this.selectedIds.delete(rowId);
  }

  get allSelected(): boolean {
    const visible = this.filteredRows;
    return visible.length > 0 && visible.every((r) => this.selectedIds.has(r.id));
  }

  toggleSelectAll(checked: boolean): void {
    if (checked) this.filteredRows.forEach((r) => this.selectedIds.add(r.id));
    else this.filteredRows.forEach((r) => this.selectedIds.delete(r.id));
  }

  // Dinas options valid for EVERY currently-selected row at once — excludes a dinas the moment
  // it's some selected row's own dinas_inisiasi, so the shared dropdown never offers a choice
  // that would fail server-side for part of the selection.
  get bulkDinasOptions(): DinasEntry[] {
    const selectedInitiators = new Set(this.rows.filter((r) => this.selectedIds.has(r.id)).map((r) => String(r.dinas_inisiasi).toUpperCase()));
    return this.dinasOptions.filter((d) => !selectedInitiators.has(d.code.toUpperCase()));
  }

  canBulkAssign(): boolean {
    return this.selectedIds.size > 0 && !!this.bulkTargetDinas;
  }

  async bulkAssign(): Promise<void> {
    if (!this.canBulkAssign()) return;
    const count = this.selectedIds.size;
    const target = this.bulkTargetDinas;
    const ok = await this.modal.confirm(`Assign ${count} baris terpilih ke dinas ${target}? Aksi ini FINAL — semua baris LANGSUNG berstatus Confirmed.`);
    if (!ok) return;
    const items = this.rows.filter((r) => this.selectedIds.has(r.id)).map((r) => ({ transaction_id: r.id, dinas_target: target }));
    const description = this.description.trim() || undefined;
    this.bulkAssigning = true;
    this.investigation.assignAll(items, description).subscribe({
      next: async () => {
        this.bulkAssigning = false;
        await this.modal.success(`${count} baris sudah di-assign ke ${target}`);
        this.changed.emit();
      },
      error: async (err) => { this.bulkAssigning = false; await this.modal.alert('Gagal menetapkan dinas untuk baris terpilih: ' + extractErrorMessage(err, String(err))); },
    });
  }
}
