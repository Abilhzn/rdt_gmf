import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DeclinedRow, ReassignmentService } from '../services/reassignment.service';
import { DinasEntry } from '../../../services/dinas.service';
import { ModalService } from '../../../services/modal.service';
import { extractErrorMessage } from '../../../core/utils/error-message.util';

/** DECLINED-resolution panel — resolve a row the target rejected, either BORNE (initiator eats it,
 * no ledger) or REASSIGN (send to a different dinas, capped at 3 attempts). Owns its own HTTP
 * (ReassignmentService) since every action here is self-contained to this row set; emits
 * `resolved` so the parent page refetches (a resolve can also affect the badge/other tab counts
 * it owns). Staging state (which action + target per row, the shared batch note) is local UI-only
 * state, not round-tripped to the parent. */
@Component({
  selector: 'rdt-declined-resolution',
  standalone: false,
  templateUrl: './declined-resolution.component.html',
})
export class DeclinedResolutionComponent {
  @Input() rows: DeclinedRow[] = [];
  @Input() dinasOptions: DinasEntry[] = [];
  /** Acting dinas (this.dinas on the old component) — excluded from reassign targets alongside
   * the row's own current dinas_target. */
  @Input() dinas = '';
  @Output() resolved = new EventEmitter<void>();

  resolvingRowId: number | null = null;
  submittingAll = false;

  reassignTargetByRowId: Record<number, string> = {};
  pendingActionByRowId: Record<number, 'BORNE' | 'REASSIGN'> = {};
  batchNote = '';

  constructor(private reassignment: ReassignmentService, private modal: ModalService) {}

  reassignTargetsFor(row: DeclinedRow): DinasEntry[] {
    const excluded = new Set([this.dinas.toUpperCase(), String(row.dinas_target).toUpperCase()]);
    return this.dinasOptions.filter((d) => !excluded.has(d.code.toUpperCase()));
  }

  async resolveBorne(row: DeclinedRow): Promise<void> {
    const ok = await this.modal.confirm('Apakah kamu sudah yakin?');
    if (!ok) return;
    this.resolvingRowId = row.id;
    this.reassignment.resolveBorne(row.id).subscribe({
      next: async () => { this.resolvingRowId = null; await this.modal.alert('Tersimpan'); this.resolved.emit(); },
      error: async (err) => { this.resolvingRowId = null; await this.modal.alert('Gagal menandai tanggung sendiri: ' + extractErrorMessage(err, String(err))); },
    });
  }

  async resolveReassign(row: DeclinedRow): Promise<void> {
    const target = this.reassignTargetByRowId[row.id];
    if (!target) { await this.modal.alert('Pilih dinas target dulu.'); return; }
    const ok = await this.modal.confirm('Apakah kamu sudah yakin?');
    if (!ok) return;
    this.resolvingRowId = row.id;
    this.reassignment.resolveReassign(row.id, target).subscribe({
      next: async () => { this.resolvingRowId = null; await this.modal.alert('Tersimpan'); this.resolved.emit(); },
      error: async (err) => { this.resolvingRowId = null; await this.modal.alert('Gagal mengajukan ulang ke dinas lain: ' + extractErrorMessage(err, String(err))); },
    });
  }

  // Stage a destination for a row (used by the "Confirm All" batch below) without resolving it
  // immediately.
  setPendingAction(row: DeclinedRow, action: 'BORNE' | 'REASSIGN' | ''): void {
    if (action) this.pendingActionByRowId[row.id] = action;
    else delete this.pendingActionByRowId[row.id];
  }

  get stagedCount(): number {
    return Object.keys(this.pendingActionByRowId).length;
  }

  canSubmitAll(): boolean {
    return this.rows.some((r) => {
      const action = this.pendingActionByRowId[r.id];
      if (!action) return false;
      if (action === 'REASSIGN' && !this.reassignTargetByRowId[r.id]) return false;
      return true;
    });
  }

  async submitAllResolutions(): Promise<void> {
    const items = this.rows
      .filter((r) => this.pendingActionByRowId[r.id])
      .map((r) => ({
        id: r.id,
        action: this.pendingActionByRowId[r.id],
        new_dinas_target: this.pendingActionByRowId[r.id] === 'REASSIGN' ? this.reassignTargetByRowId[r.id] : undefined,
      }));
    if (!items.length) { await this.modal.alert('Belum ada baris yang ditentukan tujuannya.'); return; }
    const missingTarget = items.find((i) => i.action === 'REASSIGN' && !i.new_dinas_target);
    if (missingTarget) { await this.modal.alert('Pilih dinas target dulu untuk semua baris yang diajukan ulang.'); return; }
    const ok = await this.modal.confirm(`Apakah kamu sudah yakin? ${items.length} transaksi akan diselesaikan sekaligus.`);
    if (!ok) return;
    this.submittingAll = true;
    this.reassignment.resolveBatch(items, this.batchNote).subscribe({
      next: async () => {
        this.submittingAll = false;
        this.pendingActionByRowId = {};
        this.batchNote = '';
        await this.modal.alert('Tersimpan');
        this.resolved.emit();
      },
      error: async (err) => { this.submittingAll = false; await this.modal.alert('Gagal menyimpan resolusi massal: ' + extractErrorMessage(err, String(err))); },
    });
  }
}
