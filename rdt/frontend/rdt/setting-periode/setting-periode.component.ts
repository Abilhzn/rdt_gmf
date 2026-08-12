import { Component, OnInit } from '@angular/core';
import { ExportBatchService, OverdueDeadlineEntry, PeriodDeadline } from '../services/export-batch.service';
import { ModalService } from '../services/modal.service';
import { CurrentUserService } from '@auth/services/current-user.service';

// REQ-RDT-SAP-14 — moved out of repost-history.component (11 Agu, user request: "taruh di
// sidebar-nya TAB") into its own routed page + sidebar nav item, TAB-only (RdtGuard's role check
// happens at the backend endpoints either way — this route just isn't linked/reachable in the UI
// for a non-TAB role). Logic/markup carried over verbatim from repost-history — only the container
// (own component/route instead of a <details> panel on Riwayat Repost TAB) changed.
@Component({
  selector: 'rdt-setting-periode',
  standalone: false,
  templateUrl: './setting-periode.component.html',
  styleUrls: ['./setting-periode.component.scss'],
})
export class SettingPeriodeComponent implements OnInit {
  // REQ-RDT-SAP-14 (dikonfirmasi 5 Agu malam): alur nyatanya BULK, bukan satu-satu — TAB set SATU
  // deadline yang langsung berlaku ke SEMUA pasangan aktif di periode itu. Sub-section terpisah
  // dari form override di bawah, JANGAN digabung/gantikan.
  bulkDeadlineForm = { periode: '', deadline_at: '' };
  bulkDeadlineFormBusy = false;
  bulkDeadlineFormMessage = '';
  existingDeadlines: PeriodDeadline[] = [];

  // DIPERJELAS 7 Agu — "Override Deadline" is now list-driven, not a manual dinas-picker form:
  // TAB picks a periode, sees every pasangan that's 100% confirmed but overdue (un-batched, per
  // GET /overdue), and re-evaluates one at a time with a new deadline.
  overdueListPeriode = '';
  overdueList: OverdueDeadlineEntry[] = [];
  overdueListLoading = false;
  overdueListMessage = '';
  // Keyed by "dinas_inisiasi dinas_target" — the new-deadline input and busy/result state for
  // each row in the list, since more than one could in principle be mid-entry at once.
  overrideDeadlineInputByPair: Record<string, string> = {};
  overrideBusyPair: string | null = null;

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
    public currentUser: CurrentUserService,
  ) {}

  ngOnInit(): void {
    this.loadExistingDeadlines();
  }

  // Read-only overview table, independent of the Setting Deadline / Override Deadline forms above
  // it — always the full list now (no more per-pasangan form to scope it to).
  loadExistingDeadlines(): void {
    this.exportBatches.getPeriodDeadlines().subscribe({
      next: (rows) => { this.existingDeadlines = rows; },
      error: () => { /* supplementary panel — don't block the rest of the page on it */ },
    });
  }

  private pairKey(dinasInisiasi: string, dinasTarget: string): string {
    return `${dinasInisiasi} ${dinasTarget}`;
  }

  // DIPERJELAS 7 Agu — loads "Override Deadline"'s candidate list for the selected periode. Empty
  // result is a valid, expected state (nothing overdue, or TAB already moved on to periode
  // berikutnya — see routes/periodDeadlines.js's periodeNextAlreadySet), not an error.
  loadOverdueList(): void {
    if (!this.overdueListPeriode) { this.overdueList = []; return; }
    this.overdueListLoading = true;
    this.overdueListMessage = '';
    this.exportBatches.getOverdueDeadlines(this.overdueListPeriode).subscribe({
      next: (rows) => {
        this.overdueListLoading = false;
        this.overdueList = rows;
        if (!rows.length) {
          this.overdueListMessage = `Tidak ada pasangan overdue yang bisa di-override untuk periode ${this.overdueListPeriode} (sudah semua sesuai, sudah di-repost, atau periode berikutnya sudah di-set deadline-nya).`;
        }
      },
      error: async (err) => {
        this.overdueListLoading = false;
        this.overdueList = [];
        await this.modal.alert('Gagal memuat daftar overdue: ' + (err?.message || err));
      },
    });
  }

  // Re-opens one pasangan with a new deadline — the one deliberate exception to periode_efektif
  // being a permanent snapshot, always on the strength of an out-of-band team agreement (same
  // pattern as Investigation's assign flow), hence the explicit confirm dialog before submitting.
  async submitOverride(entry: OverdueDeadlineEntry): Promise<void> {
    const key = this.pairKey(entry.dinas_inisiasi, entry.dinas_target);
    const deadlineAt = this.overrideDeadlineInputByPair[key];
    if (!deadlineAt) return;
    const ok = await this.modal.confirm(
      `Override deadline ${entry.dinas_inisiasi} → ${entry.dinas_target} periode ${this.overdueListPeriode} ` +
      `jadi ${new Date(deadlineAt).toLocaleString('id-ID')}? Ini akan RE-EVALUASI periode_efektif pasangan ini ` +
      `berdasarkan deadline baru — pastikan sudah ada kesepakatan tim di luar sistem sebelum lanjut.`
    );
    if (!ok) return;
    this.overrideBusyPair = key;
    this.exportBatches.overrideDeadline(entry.dinas_inisiasi, entry.dinas_target, this.overdueListPeriode, new Date(deadlineAt).toISOString()).subscribe({
      next: async (result) => {
        this.overrideBusyPair = null;
        delete this.overrideDeadlineInputByPair[key];
        await this.modal.success(
          `${result.dinas_inisiasi} → ${result.dinas_target}: ${result.reevaluated.length} transaksi di-re-evaluasi. ` +
          `periode_efektif baru: ${result.reevaluated[0]?.new_periode_efektif ?? this.overdueListPeriode}.`
        );
        this.loadOverdueList();
        this.loadExistingDeadlines();
      },
      error: async (err) => {
        this.overrideBusyPair = null;
        await this.modal.alert('Gagal override deadline: ' + (err?.message || err));
      },
    });
  }

  // Bulk — the actual real-world workflow (confirmed 5 Agu malam): one deadline applies to every
  // pasangan currently active in that periode (routes/periodDeadlines.js's POST /bulk decides
  // "active" server-side — has a non-terminal transaction in that periode). Confirmed before
  // submitting since it can touch many pasangan at once, same pattern as other multi-row actions
  // in this app (Investigation's "Assign All", Confirmation's batch resolve).
  async submitBulkDeadline(): Promise<void> {
    const { periode, deadline_at } = this.bulkDeadlineForm;
    if (!periode || !deadline_at) return;
    const ok = await this.modal.confirm(
      `Set deadline periode ${periode} = ${new Date(deadline_at).toLocaleString('id-ID')} untuk SEMUA pasangan aktif di periode itu? ` +
      `Ini akan menimpa deadline yang sudah ada untuk pasangan-pasangan tersebut.`
    );
    if (!ok) return;
    this.bulkDeadlineFormBusy = true;
    this.bulkDeadlineFormMessage = '';
    this.exportBatches.setBulkPeriodDeadline(periode, new Date(deadline_at).toISOString()).subscribe({
      next: (rows) => {
        this.bulkDeadlineFormBusy = false;
        this.bulkDeadlineFormMessage = rows.length
          ? `Deadline periode ${periode} diterapkan ke ${rows.length} pasangan: ${rows.map((r) => `${r.dinas_inisiasi}→${r.dinas_target}`).join(', ')}.`
          : `Tidak ada pasangan aktif di periode ${periode} — tidak ada deadline yang di-set.`;
        this.loadExistingDeadlines();
      },
      error: async (err) => {
        this.bulkDeadlineFormBusy = false;
        await this.modal.alert('Gagal menyimpan deadline massal: ' + (err?.message || err));
      },
    });
  }
}
