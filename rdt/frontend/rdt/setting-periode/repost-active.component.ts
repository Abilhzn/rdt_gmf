import { Component, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { ExportBatchService, ActivePairEntry, OverdueDeadlineEntry } from '../services/export-batch.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// REQ-RDT-SAP-20 (13 Agu, "'Repost' Active") — merges the old "Override Deadline" panel and the
// read-only "Semua deadline yang pernah di-set" table into ONE Excel-sheet-style table, tab per
// periode (MM-YYYY) like Riwayat Repost (repost-history.component.ts's monthKeyOf/monthGroups
// pattern, reused here). Opsi A (dipilih project owner 13 Agu, dari 3 opsi yang ditawarkan): tiap
// tab = UNION pasangan AKTIF (belum selesai, GET /active-pairs) + pasangan OVERDUE (sudah
// confirmed tapi lewat deadline, un-batched, GET /overdue) untuk periode itu — bukan cuma salah
// satu. Kandidat periode = union tiap periode yang PERNAH dapat deadline (per-pasangan atau
// default) — periode tanpa deadline sama sekali gak mungkin punya baris overdue, dan pasangan
// aktifnya "normal", gak ada yang perlu dikelola di sini.
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
  selector: 'rdt-repost-active',
  standalone: false,
  templateUrl: './repost-active.component.html',
  styleUrls: ['./setting-periode.component.scss', './repost-active.component.scss'],
})
export class RepostActiveComponent implements OnInit {
  loading = true;
  errorMessage = '';
  // Tab key (MM-YYYY, same format Riwayat Repost uses) -> rows for that periode.
  rowsByMonthKey: Record<string, ActiveRow[]> = {};
  // MM-YYYY -> the underlying "YYYY-MM" periode string the backend calls actually use.
  periodeByMonthKey: Record<string, string> = {};
  selectedMonthKey: string | null = null;

  overrideDeadlineInputByPair: Record<string, string> = {};
  overrideBusyPair: string | null = null;

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

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

  get activePeriode(): string | null {
    return this.activeMonthKey ? this.periodeByMonthKey[this.activeMonthKey] : null;
  }

  selectMonth(key: string): void {
    this.selectedMonthKey = key;
  }

  load(): void {
    this.errorMessage = '';
    this.loading = true;
    forkJoin({
      perPair: this.exportBatches.getPeriodDeadlines(),
      defaults: this.exportBatches.getDefaultPeriodDeadlines(),
    }).subscribe({
      next: ({ perPair, defaults }) => {
        const periodes = Array.from(new Set([...perPair.map((d) => d.periode), ...defaults.map((d) => d.periode)]));
        this.loadRows(periodes);
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = extractErrorMessage(err, 'Gagal memuat daftar periode');
      },
    });
  }

  private loadRows(periodes: string[]): void {
    if (!periodes.length) {
      this.rowsByMonthKey = {};
      this.periodeByMonthKey = {};
      this.loading = false;
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
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = extractErrorMessage(err, 'Gagal memuat pasangan aktif/overdue');
      },
    });
  }

  // Re-opens one OVERDUE pasangan with a new deadline — the one deliberate exception to
  // periode_efektif being a permanent snapshot, always on the strength of an out-of-band team
  // agreement (same pattern as Investigation's assign flow).
  async submitOverride(row: ActiveRow): Promise<void> {
    if (row.status !== 'OVERDUE' || !this.activePeriode) return;
    const periode = this.activePeriode;
    const key = this.pairKey(row.dinas_inisiasi, row.dinas_target);
    const deadlineAt = this.overrideDeadlineInputByPair[key];
    if (!deadlineAt) return;
    const ok = await this.modal.confirm(
      `Override deadline ${row.dinas_inisiasi} → ${row.dinas_target} periode ${periode} jadi ` +
      `${new Date(deadlineAt).toLocaleString('id-ID')}? Ini akan RE-EVALUASI periode_efektif pasangan ini ` +
      `berdasarkan deadline baru — pastikan sudah ada kesepakatan tim di luar sistem sebelum lanjut.`
    );
    if (!ok) return;
    this.overrideBusyPair = key;
    this.exportBatches.overrideDeadline(row.dinas_inisiasi, row.dinas_target, periode, new Date(deadlineAt).toISOString()).subscribe({
      next: async (result) => {
        this.overrideBusyPair = null;
        delete this.overrideDeadlineInputByPair[key];
        await this.modal.success(
          `${result.dinas_inisiasi} → ${result.dinas_target}: ${result.reevaluated.length} transaksi di-re-evaluasi. ` +
          `periode_efektif baru: ${result.reevaluated[0]?.new_periode_efektif ?? periode}.`
        );
        this.load();
      },
      error: async (err) => {
        this.overrideBusyPair = null;
        await this.modal.alert('Gagal override deadline: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
