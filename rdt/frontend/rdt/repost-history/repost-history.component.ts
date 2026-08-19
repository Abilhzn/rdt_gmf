import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ExportBatchService, HistoryBatch } from '../services/export-batch.service';
import { triggerBlobDownload, filenameFromResponse } from '../services/confirmation.service';
import { ModalService } from '../services/modal.service';
import { CurrentUserService } from '@auth/services/current-user.service';
import { matchesAnyFilterValue } from '../shared/multi-value-filter.component';
import { extractErrorMessage } from '../shared/error-message.util';

// List splits into month "sheets" (like separate tabs in one Excel workbook), labeled literally
// MM-YYYY (e.g. "06-2026") — not a localized month name.
export interface MonthGroup {
  key: string;
  batches: HistoryBatch[];
}

function monthKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

// "YYYY-MM" (rdt.uploads.period) -> this page's "MM-YYYY" tab-key format.
function periodToMonthKey(period: string): string {
  const [yyyy, mm] = period.split('-');
  return `${mm}-${yyyy}`;
}

function monthKeySortValue(key: string): number {
  const [mm, yyyy] = key.split('-');
  return Number(yyyy) * 100 + Number(mm);
}

// "Riwayat Repost TAB/Dinas" — the archive destination once a batch gets its first subdoc (see
// need-approval.component's addSubdoc). Also the in-app substitute for email notification (SMTP
// out of scope) — PICs already got their in-app notification + comment at Confirm time, this page
// is a browsable log on top. NOT TAB-only — GET /history auto-scopes to the caller's own
// dinas_inisiasi for non-TAB users, TAB sees every dinas. Same endpoint, same table, two
// viewpoints. Adding a subdoc and downloading the export file stay TAB-only actions.
@Component({
  selector: 'rdt-repost-history',
  standalone: false,
  templateUrl: './repost-history.component.html',
  styleUrls: ['./repost-history.component.scss'],
})
export class RepostHistoryComponent implements OnInit {
  batches: HistoryBatch[] = [];
  errorMessage = '';
  // Bulan+Tahun dropdown over the batch's declared/effective period ('YYYY-MM', same precedence
  // monthGroups uses).
  filterMonth = '';
  filterYear = '';
  readonly months = [
    { value: '01', label: 'Januari' }, { value: '02', label: 'Februari' }, { value: '03', label: 'Maret' },
    { value: '04', label: 'April' }, { value: '05', label: 'Mei' }, { value: '06', label: 'Juni' },
    { value: '07', label: 'Juli' }, { value: '08', label: 'Agustus' }, { value: '09', label: 'September' },
    { value: '10', label: 'Oktober' }, { value: '11', label: 'November' }, { value: '12', label: 'Desember' },
  ];
  // A handful of years around now — plenty for a Repost archive filter, no need to derive from data.
  readonly years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 3 + i));
  // Distinguishes "still loading" from "genuinely nothing archived yet".
  loading = true;

  // Subdoc entry is TAB-only and can be repeated on an already-archived batch (splitting a large
  // pair across several subdocs over time) — one input per batch row, keyed by batch id since
  // more than one row can be mid-entry at once.
  subdocInputByBatchId: Record<number, string> = {};
  addingSubdocBatchId: number | null = null;

  // Paste-many-values filter on subdoc number — "cari nomor refdoc/subdoc untuk cross-check" is
  // this page's own stated purpose, so that's the filterable column here.
  subdocFilterValues: string[] = [];

  get filteredBatches(): HistoryBatch[] {
    if (!this.subdocFilterValues.length) return this.batches;
    return this.batches.filter((b) => b.subdoc_numbers.some((num) => matchesAnyFilterValue(num, this.subdocFilterValues)));
  }

  onSubdocFilterChange(values: string[]): void {
    this.subdocFilterValues = values;
  }

  // Month "sheets" grouped by the EFFECTIVE period (period_efektif), not the declared period — a
  // pasangan whose dinas target confirmed after TAB's deadline archives under the NEXT month, not
  // the month the data was declared for. Falls back to `period` then confirmed_at for legacy
  // batches with neither. Sorted oldest to newest, independent of the subdoc paste-filter above.
  selectedMonthKey: string | null = null;

  get monthGroups(): MonthGroup[] {
    const byKey = new Map<string, HistoryBatch[]>();
    for (const b of this.filteredBatches) {
      const effective = b.period_efektif || b.period;
      const key = effective ? periodToMonthKey(effective) : monthKeyOf(b.confirmed_at);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(b);
    }
    return Array.from(byKey.entries())
      .sort(([a], [b]) => monthKeySortValue(a) - monthKeySortValue(b))
      .map(([key, batches]) => ({ key, batches }));
  }

  // Falls back to the most recent month whenever selectedMonthKey is unset or no longer exists
  // in the current (possibly re-filtered) group list — e.g. right after load() or a subdoc filter
  // change that empties out the previously active month.
  get activeMonthKey(): string | null {
    const groups = this.monthGroups;
    if (this.selectedMonthKey && groups.some((g) => g.key === this.selectedMonthKey)) return this.selectedMonthKey;
    return groups.length ? groups[groups.length - 1].key : null;
  }

  get activeMonthBatches(): HistoryBatch[] {
    return this.monthGroups.find((g) => g.key === this.activeMonthKey)?.batches || [];
  }

  selectMonth(key: string): void {
    this.selectedMonthKey = key;
  }

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
    public currentUser: CurrentUserService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  get isTab(): boolean {
    return this.currentUser.current?.role === 'TAB';
  }

  load(): void {
    this.errorMessage = '';
    this.loading = true;
    const periode = this.filterMonth && this.filterYear ? `${this.filterYear}-${this.filterMonth}` : undefined;
    this.exportBatches.getHistory(periode).subscribe({
      next: (batches) => { this.batches = batches; this.loading = false; },
      error: (err) => { this.errorMessage = extractErrorMessage(err, 'Gagal memuat riwayat repost'); this.loading = false; },
    });
  }

  clearFilter(): void {
    this.filterMonth = '';
    this.filterYear = '';
    this.load();
  }

  // >300 rows comes back as a .zip instead of .xlsx — the actual filename (with the right
  // extension) comes from the response, not guessed client-side.
  download(batch: HistoryBatch): void {
    this.exportBatches.downloadExport(batch.id).subscribe({
      next: (res) => {
        const dateStr = new Date().toISOString().slice(0, 10);
        const fallback = `${batch.dinas_inisiasi}-${batch.dinas_target}_${dateStr}.xlsx`;
        triggerBlobDownload(res.body!, filenameFromResponse(res.headers, fallback));
      },
      error: async (err) => { await this.modal.alert('Gagal mengunduh: ' + extractErrorMessage(err, String(err))); },
    });
  }

  // An archived pair's thread/chain is already fully queryable via GET
  // /api/dashboard/detail/:initiator/:target (filters by status_konfirmasi only, not
  // export_batch_id) — Dashboard-Detailing works for archived pairs with zero backend changes.
  // Same relative-navigation pattern HomeComponent.goToInvestigation() uses ('repost-history' and
  // 'dashboard' are sibling routes under the same ShellComponent).
  goToDetail(batch: HistoryBatch): void {
    this.router.navigate(['../dashboard/detail', batch.dinas_inisiasi, batch.dinas_target], { relativeTo: this.route });
  }

  // Defaults to covering every remaining unassigned line in the batch (see
  // routes/exportBatches.js's POST /:batchId/subdocs) — the common case where one subdoc covers
  // the whole pair. A dedicated line-picker for splitting a batch across several subdocs isn't
  // built here; TAB can still call the same endpoint with specific transaction_ids directly if
  // that's ever needed.
  async addSubdoc(batch: HistoryBatch): Promise<void> {
    const subdocNumber = (this.subdocInputByBatchId[batch.id] || '').trim();
    if (!subdocNumber) return;
    this.addingSubdocBatchId = batch.id;
    this.exportBatches.addSubdoc(batch.id, subdocNumber).subscribe({
      next: async () => {
        this.addingSubdocBatchId = null;
        delete this.subdocInputByBatchId[batch.id];
        await this.modal.success(`Subdoc ${subdocNumber} ditambahkan untuk ${batch.dinas_inisiasi} → ${batch.dinas_target}`);
        this.load();
      },
      error: async (err) => {
        this.addingSubdocBatchId = null;
        await this.modal.alert('Gagal menambah subdoc: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
