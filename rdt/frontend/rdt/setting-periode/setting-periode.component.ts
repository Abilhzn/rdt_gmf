import { Component, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import {
  ExportBatchService,
  PeriodDefaultDeadline,
  ActivePairEntry,
  OverdueDeadlineEntry,
} from '../services/export-batch.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// SRS 3.13, "Struktur navigasi disederhanakan lagi" (14 Agu): section 3.12's split into 2
// sub-pages ("Setting Deadline" + "'Repost' Active", each its own sidebar sub-item) is DIBATALKAN
// — back to ONE flat page/nav-item, form on top + the active/overdue table below it, no
// navigation required between them. This component folds SettingDeadlineComponent +
// RepostActiveComponent (both now deleted) back into one — logic unchanged from either, just
// merged into a single class. "Override Deadline" per row (SRS text for this section still
// mentions it) stays OMITTED per project owner's explicit 18 Agu confirmation: it directly
// contradicts REQ-RDT-SAP-21's sticky-overdue rule from the same section 3.13, so the OVERDUE rows
// below remain informational-only (see repost-active.component's old header comment, same
// reasoning, just carried over here).
export interface ActiveRow {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  status: 'ACTIVE' | 'OVERDUE';
  open_count?: number;
  periode_efektif?: string;
}

function periodToMonthKey(period: string): string {
  const [yyyy, mm] = period.split('-');
  return `${mm}-${yyyy}`;
}

function monthKeySortValue(key: string): number {
  const [mm, yyyy] = key.split('-');
  return Number(yyyy) * 100 + Number(mm);
}

@Component({
  selector: 'rdt-setting-periode',
  standalone: false,
  templateUrl: './setting-periode.component.html',
  styleUrls: ['./setting-periode.component.scss'],
})
export class SettingPeriodeComponent implements OnInit {
  // ---------- Setting Deadline form (was SettingDeadlineComponent) ----------
  defaultDeadlineForm = { periode: '', deadline_at: '' };
  defaultDeadlineFormBusy = false;
  defaultDeadlineFormMessage = '';
  existingDefaultDeadlines: PeriodDefaultDeadline[] = [];
  deletingPeriode: string | null = null;

  // ---------- Active/overdue list (was RepostActiveComponent) ----------
  activeLoading = true;
  activeErrorMessage = '';
  rowsByMonthKey: Record<string, ActiveRow[]> = {};
  periodeByMonthKey: Record<string, string> = {};
  selectedMonthKey: string | null = null;

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.loadDeadlines();
    this.loadActive();
  }

  // ---------- Setting Deadline ----------
  loadDeadlines(): void {
    this.exportBatches.getDefaultPeriodDeadlines().subscribe({
      next: (rows) => { this.existingDefaultDeadlines = rows; },
      error: () => { /* supplementary panel — don't block the rest of the page on it */ },
    });
  }

  // REQ-RDT-SAP-19 — deletable only before the deadline itself passes, same guard the backend
  // enforces (routes/periodDeadlines.js DELETE /default/:periode).
  canDelete(row: PeriodDefaultDeadline): boolean {
    return new Date(row.deadline_at).getTime() > Date.now();
  }

  async deleteDefault(row: PeriodDefaultDeadline): Promise<void> {
    const ok = await this.modal.confirm(`Hapus deadline default periode ${row.periode}? Pasangan yang belum muncul di periode ini gak lagi otomatis dapat deadline.`);
    if (!ok) return;
    this.deletingPeriode = row.periode;
    this.exportBatches.deleteDefaultPeriodDeadline(row.periode).subscribe({
      next: () => { this.deletingPeriode = null; this.loadDeadlines(); this.loadActive(); },
      error: async (err) => {
        this.deletingPeriode = null;
        await this.modal.alert('Gagal menghapus deadline: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  // REQ-RDT-SAP-20 — one action: sweeps existing active pasangan immediately AND sets the default
  // for pasangan that show up later, both in the same request.
  async submitDefaultDeadline(): Promise<void> {
    const { periode, deadline_at } = this.defaultDeadlineForm;
    if (!periode || !deadline_at) return;
    const ok = await this.modal.confirm(
      `Set deadline periode ${periode} = ${new Date(deadline_at).toLocaleString('id-ID')}? ` +
      `Ini langsung berlaku ke SEMUA pasangan yang sedang aktif di periode ini sekarang, dan otomatis jadi ` +
      `default buat pasangan manapun yang baru muncul nanti di periode ini (kecuali punya override sendiri).`
    );
    if (!ok) return;
    this.defaultDeadlineFormBusy = true;
    this.defaultDeadlineFormMessage = '';
    this.exportBatches.setDefaultPeriodDeadline(periode, new Date(deadline_at).toISOString()).subscribe({
      next: (res) => {
        this.defaultDeadlineFormBusy = false;
        const sweptNote = res.swept.length
          ? ` ${res.swept.length} pasangan aktif langsung ikut ter-set: ${res.swept.map((r) => `${r.dinas_inisiasi}→${r.dinas_target}`).join(', ')}.`
          : ' Tidak ada pasangan aktif di periode ini saat ini — deadline tetap tersimpan sebagai default.';
        this.defaultDeadlineFormMessage = `Deadline periode ${res.deadline.periode} tersimpan: ${new Date(res.deadline.deadline_at).toLocaleString('id-ID')}.${sweptNote}`;
        this.loadDeadlines();
        this.loadActive();
      },
      error: async (err) => {
        this.defaultDeadlineFormBusy = false;
        await this.modal.alert('Gagal menyimpan deadline: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  // ---------- Active/overdue list ----------
  private pairKey(a: string, b: string): string {
    return `${a} ${b}`;
  }

  get monthKeys(): string[] {
    return Object.keys(this.rowsByMonthKey).sort((a, b) => monthKeySortValue(a) - monthKeySortValue(b));
  }

  get activeMonthKey(): string | null {
    const keys = this.monthKeys;
    if (this.selectedMonthKey && this.rowsByMonthKey[this.selectedMonthKey]) return this.selectedMonthKey;
    return keys.length ? keys[keys.length - 1] : null;
  }

  get activeRows(): ActiveRow[] {
    return this.activeMonthKey ? this.rowsByMonthKey[this.activeMonthKey] : [];
  }

  selectMonth(key: string): void {
    this.selectedMonthKey = key;
  }

  loadActive(): void {
    this.activeErrorMessage = '';
    this.activeLoading = true;
    forkJoin({
      perPair: this.exportBatches.getPeriodDeadlines(),
      defaults: this.exportBatches.getDefaultPeriodDeadlines(),
    }).subscribe({
      next: ({ perPair, defaults }) => {
        const periodes = Array.from(new Set([...perPair.map((d) => d.periode), ...defaults.map((d) => d.periode)]));
        this.loadRows(periodes);
      },
      error: (err) => {
        this.activeLoading = false;
        this.activeErrorMessage = extractErrorMessage(err, 'Gagal memuat daftar periode');
      },
    });
  }

  private loadRows(periodes: string[]): void {
    if (!periodes.length) {
      this.rowsByMonthKey = {};
      this.periodeByMonthKey = {};
      this.activeLoading = false;
      return;
    }
    forkJoin(periodes.map((periode) => forkJoin({
      periode: of(periode),
      active: this.exportBatches.getActivePairs(periode),
      overdue: this.exportBatches.getOverdueDeadlines(periode),
    }))).subscribe({
      next: (results) => {
        const rowsByMonthKey: Record<string, ActiveRow[]> = {};
        const periodeByMonthKey: Record<string, string> = {};
        for (const { periode, active, overdue } of results) {
          const overdueKeys = new Set(overdue.map((o) => this.pairKey(o.dinas_inisiasi, o.dinas_target)));
          const rows: ActiveRow[] = [
            ...overdue.map((o): ActiveRow => ({
              dinas_inisiasi: o.dinas_inisiasi, dinas_target: o.dinas_target, total: o.total,
              status: 'OVERDUE', periode_efektif: o.periode_efektif,
            })),
            ...active
              .filter((a) => !overdueKeys.has(this.pairKey(a.dinas_inisiasi, a.dinas_target)))
              .map((a): ActiveRow => ({
                dinas_inisiasi: a.dinas_inisiasi, dinas_target: a.dinas_target, total: a.total,
                status: 'ACTIVE', open_count: a.open_count,
              })),
          ];
          if (!rows.length) continue;
          const key = periodToMonthKey(periode);
          rowsByMonthKey[key] = rows;
          periodeByMonthKey[key] = periode;
        }
        this.rowsByMonthKey = rowsByMonthKey;
        this.periodeByMonthKey = periodeByMonthKey;
        this.activeLoading = false;
      },
      error: (err) => {
        this.activeLoading = false;
        this.activeErrorMessage = extractErrorMessage(err, 'Gagal memuat pasangan aktif/overdue');
      },
    });
  }
}
