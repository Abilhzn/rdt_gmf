import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ConfirmationService, PendingRow, ConfirmationClaim, DeclinedOutcomeRow, RedirectedOutcomeRow, triggerBlobDownload } from '../services/confirmation.service';
import { ReassignmentService, DeclinedRow } from '../services/reassignment.service';
import { DinasService, DinasEntry } from '../services/dinas.service';
import { ModalService } from '../services/modal.service';
import { DashboardDetailService } from '../services/dashboard-detail.service';
import { Comment } from '../services/comment.model';
import { InvestigationService, InvestigationRow } from '../services/investigation.service';
import { matchesAllColumnFilters } from '../shared/multi-value-filter.component';
import { TransactionService, ContractField } from '../services/transaction.service';

interface PendingRowVm extends PendingRow {
  checked: boolean;
  /** '' = balik ke pengaju (default DECLINED flow); a dinas code = reject-and-redirect there
   * immediately (item 7). Only meaningful when checked=false. */
  redirectTo: string;
}

interface PreviewColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

interface ThreadRow {
  comment: Comment;
  depth: number;
}

// REQ-RDT-NAV-04 — rebuilt to match the updated Figma (node 20:712, "Confirmation"):
// single checkbox per row (checked=Confirm, unchecked=Reject) + Select All, ALL visible
// rows get submitted (no "skip, undecided" state) — confirmed with the project owner.
// Auto-resolves the acting dinas from the logged-in user instead of requiring a :dinas
// route param; an optional ?from=<dinas> query param (set when navigating here from
// Dashboard's "Need to Confirm" buttons) filters the PENDING list to just that initiator
// dinas, matching the "[Dinas Lain] → [User]" badge in the design.
//
// Export-batch approval (REQ-RDT-SAP-01/02) moved to its own NeedApprovalComponent/page —
// the updated Figma sidebar has "Need Approval" as a separate nav item now.
@Component({
  selector: 'rdt-confirm',
  standalone: false,
  templateUrl: './confirm.component.html',
  styleUrls: ['./confirm.component.scss'],
})
export class ConfirmComponent implements OnInit {
  dinas = '';
  /** Which target queue is loaded. Equals the user's own dinas, except for role TAB, who
   * additionally staffs dinas "Corp" (item 3 — Corp has no dedicated PIC, TAB acts on its
   * behalf, but the label stays "Corp" everywhere; see middleware/auth.js's requireDinasAccess
   * special case). TAB gets a picker to switch between their own queue and Corp's. */
  selectedTarget = '';
  filterFromDinas: string | null = null;
  /** ?target=<dinas> — set when navigating here from a "Need to Confirm" dashboard card, which
   * knows the REAL queue a submission sits in (a plain dinas's own PIC, or 'Corp' — TAB's only
   * no-dedicated-PIC queue, REQ-RDT-AUTH-04). Without it, selectedTarget falls back to the
   * user's own dinas. REQ-RDT-AUTH-05 (corrected 31 Jul): 'TA' was removed from the set of
   * TAB-staffed queues here — a 28 Jul fix had briefly treated it like Corp on the mistaken
   * assumption TA had no dedicated PIC; TA rows now only ever show up under TA's own PIC login. */
  filterTargetDinas: string | null = null;
  pendingRows: PendingRowVm[] = [];
  declinedRows: DeclinedRow[] = [];
  dinasOptions: DinasEntry[] = [];

  // REQ-RDT-NAV-04 (DITEGASKAN LAGI 5 Agu, "full column preview everywhere"): this queue used to
  // hardcode Account/Ref.Doc/Nominal/Remark only — same shared column source (GET
  // /api/contract-fields) repost-budgeting.component.ts and need-approval.component.ts already
  // use, so whatever's visible at Upload Detail Transaction stays visible here too.
  previewColumns: PreviewColumn[] = [];

  /** REQ-RDT-UI-05 "Rincian per-hop" (4 Agu): which row's chain popover is open, at most one at a
   * time — same "one at a time" convention as home.component's expandedChainKey. A table cell has
   * no room to widen sideways like the Dashboard cards do, so this opens a small floating popover
   * instead (see confirm.component.scss's .chain-popover). */
  expandedChainRowId: number | null = null;
  /** Fixed-position coords for the open popover, computed from the trigger button's own
   * bounding rect (see toggleChainPopover) — position:absolute would get clipped by
   * .table-scroll's `overflow-x: auto` (which forces overflow-y to a clipping value too, per
   * the CSS spec, even though only overflow-x was set), so this escapes via position:fixed
   * instead, which isn't confined by an ancestor's overflow. */
  chainPopoverTop = 0;
  chainPopoverLeft = 0;

  // REQ-RDT-NAV-05 (baru 3 Agu): baris DECLINED/sedang-direassign pindah ke tab/sheet terpisah
  // (mirip tab sheet Excel), bukan ditumpuk di bawah tabel pending — dan tab ini cuma dirender
  // sama sekali kalau ADA datanya (lihat confirm.component.html's *ngIf="declinedRows.length").
  activeQueueTab: 'pending' | 'declined' = 'pending';

  selectQueueTab(tab: 'pending' | 'declined'): void {
    this.activeQueueTab = tab;
  }

  statusError = '';
  emptyNote = '';
  reassignTargetByRowId: Record<number, string> = {};

  // REQ-RDT-NAV-07 (direvisi 5 Agu, 100->50): paginate the pending table instead of dumping every
  // row on one page, using the shared pager (50 rows/page) also used by Repost's review table.
  page = 1;
  readonly pageSize = 50;
  // REQ-RDT-NAV-09 (diperluas 1 Agu): satu filter multi-value per KOLOM, bukan cuma Account —
  // keyed by PendingRowVm's own field names (dinas_inisiasi/account/ref_doc/nominal/remark), AND
  // antar kolom aktif, OR di dalam satu kolom (matchesAllColumnFilters).
  pendingColumnFilters: Record<string, string[]> = {};

  // Item 7: right after a submit, show exactly which rows were declined vs redirected (from
  // the submit response, no refetch needed) as immediate feedback for the confirming user —
  // separate from declinedRows below, which is a different person's queue (the INITIATOR's,
  // resolved as this.dinas, not selectedTarget).
  justDeclined: DeclinedOutcomeRow[] = [];
  justRedirected: RedirectedOutcomeRow[] = [];

  /** Project owner request (25 Jul): optional note attached to a Confirm submit — posted
   * server-side as a reply under the initiator's repost-description comment in the pair's
   * Dashboard-Detailing thread. Cleared on every fresh loadStatus() like justDeclined/justRedirected. */
  confirmDescription = '';

  // Item 10: "Confirm All" — pick an action for every declined row first, then submit them
  // all in one batch (existing per-row resolveBorne/resolveReassign buttons stay available for
  // one-at-a-time use). Item 7/10's optional shared note travels with whichever submit path
  // is used (single resolve or batch).
  pendingActionByRowId: Record<number, 'BORNE' | 'REASSIGN'> = {};
  batchNote = '';

  // Project owner request (28 Jul): "liatin dulu chatnya" before deciding Ya/Tidak — read-only
  // preview of the pair's existing discussion, shown above the transaction list. Only meaningful
  // when filtered to ONE specific (initiator, target) pair (see showThread below); posting/
  // replying stays on Dashboard-Detailing, reached via goToThreadDetail().
  threadRows: ThreadRow[] = [];
  threadLoaded = false;

  // REQ-RDT-LEDGER-10 restructure (29 Jul, project owner request): Investigation/Ask TA folded
  // into Confirmation as a third TAB-only sub-tab (was a standalone InvestigationComponent/route
  // before) — same "swap the whole normal-queue section for a differently-shaped queue" approach
  // as ui-demo.html's ground truth. selectedTarget === 'INVESTIGATION' is the sentinel (not a
  // real dinas code, driven by the shell sidebar's sub-nav via ?target=INVESTIGATION).
  isInvestigation = false;
  investigationRows: InvestigationRow[] = [];
  investigationTargetByRowId: Record<number, string> = {};
  /** Optional note explaining why each row went to its chosen dinas — same comment system as
   * Repost, posted on the newly-assigned pair's Dashboard-Detailing thread (see
   * routes/investigation.js's postPairComment). */
  investigationDescription = '';

  // REQ-RDT-LEDGER-10 addition (30 Jul, TAB meeting): checkbox + Select All bulk-select, assigned
  // to ONE shared dinas_target in one action — a lighter alternative to "Assign All" above (which
  // requires every row to already have its OWN per-row target chosen first). Both call the same
  // backend endpoint (routes/investigation.js's assign-all already accepts any subset of items,
  // no backend change needed) — single-row Assign stays available for rows with a different
  // answer than the rest, per project owner: "assign satu-per-satu tetap harus tersedia".
  selectedInvestigationIds = new Set<number>();
  bulkTargetDinas = '';
  // REQ-RDT-NAV-09 (diperluas 1 Agu): filter per kolom — narrows what's shown/selectable, but
  // NOT what "Assign All" targets (that stays literally every awaiting-investigation row, its
  // pre-existing meaning).
  investigationColumnFilters: Record<string, string[]> = {};

  get filteredInvestigationRows(): InvestigationRow[] {
    return this.investigationRows.filter((r) => matchesAllColumnFilters(r, this.investigationColumnFilters, (row, key) => (row as any)[key]));
  }

  onInvestigationColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.investigationColumnFilters[key] = values;
    else delete this.investigationColumnFilters[key];
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public currentUser: CurrentUserService,
    private confirmation: ConfirmationService,
    private reassignment: ReassignmentService,
    private dinasService: DinasService,
    private dashboardDetail: DashboardDetailService,
    private investigation: InvestigationService,
    private modal: ModalService,
    private txService: TransactionService,
  ) {
    this.txService.getContractFields().subscribe((fields) => {
      this.previewColumns = this.buildPreviewColumns(fields);
    });
  }

  // Same "sub_group first, then every contract field, then the operational extras that matter
  // in THIS specific queue" shape as need-approval.component.ts's own buildPreviewColumns —
  // dinas_target/status_konfirmasi are dropped here since every row in this queue already shares
  // the same value for both (this dinas, PENDING), unlike Repost Review's mixed preview.
  private buildPreviewColumns(fields: ContractField[]): PreviewColumn[] {
    const contractCols: PreviewColumn[] = fields.map((f) =>
      f.key === 'in_pclc' ? { key: 'in_pclc', label: 'Nominal', numeric: true } : { key: f.key, label: f.label },
    );
    return [
      { key: 'sub_group', label: 'Sub Group' },
      ...contractCols,
      { key: 'category', label: 'Kategori' },
      { key: 'remark', label: 'Remark' },
      // BUG FIX (5 Agu, project owner): the sticky column at the right edge was pinning `remark`
      // (raw Excel routing text) under the label "Notes" — but "Notes" is supposed to be the
      // uploading user's OWN per-row note from the Repost Review step (reviewer_note, now
      // persisted — migration 015), a completely different field. `remark` stays as an ordinary
      // scrollable column above; this is the one that's actually sticky (see the template).
      { key: 'reviewer_note', label: 'Notes' },
    ];
  }

  getCellValue(row: PendingRowVm, key: string): string | number | null | undefined {
    return row[key] as string | number | null | undefined;
  }

  // Closes the chain popover on any click outside it — same pattern
  // shared/multi-value-filter.component.ts uses for its own popup. toggleChainPopover already
  // stopPropagation()s the click that OPENS it, so this only ever fires for genuinely outside
  // clicks, not the opening click itself bubbling up.
  @HostListener('document:click')
  onDocumentClick(): void {
    this.expandedChainRowId = null;
  }

  // BUG FIX (28 Jul, found while verifying the thread-reorder change): user$ and queryParamMap
  // used to be two SEPARATE subscriptions, each independently calling resolveDinasAndLoad() on
  // init. Since user$ (a BehaviorSubject) fires synchronously the moment it's subscribed —
  // BEFORE the queryParamMap subscription two lines down even exists yet — that first call
  // always ran with filterFromDinas/filterTargetDinas still at their unset defaults, firing an
  // HTTP request for the WRONG queue (the viewer's own dinas, not the one linked to). Whichever
  // of the two requests happened to resolve LAST won, so the pending table was empty or wrong
  // roughly half the time depending on network timing — exactly the intermittent "no rows" bug
  // reported live. combineLatest fires once per actual change with BOTH inputs already current,
  // so there's only ever one load in flight for a given (user, params) combination.
  ngOnInit(): void {
    this.dinasService.getActiveDinas().subscribe((d) => (this.dinasOptions = d));
    combineLatest([this.currentUser.user$, this.route.queryParamMap]).subscribe(([, params]) => {
      this.filterFromDinas = params.get('from');
      this.filterTargetDinas = params.get('target');
      this.resolveDinasAndLoad();
    });
  }

  private resolveDinasAndLoad(): void {
    const user = this.currentUser.current;
    this.dinas = user?.dinas || '';
    // ?target= overrides the default queue — set by the shell sidebar's Corp/Investigation
    // sub-nav (TAB-only). Without it: TAB defaults to the 'Corp' sub-tab (dinas_target can never
    // literally be 'TAB' — see schema.sql's rdt.dinas seed comment — so falling back to
    // this.dinas would always show an empty queue for TAB); a plain PIC defaults to their own.
    if (this.filterTargetDinas) {
      this.selectedTarget = this.filterTargetDinas;
    } else if (user) {
      this.selectedTarget = user.role === 'TAB' ? 'Corp' : this.dinas;
    }
    if (this.dinas) this.loadStatus();
  }

  get badgeText(): string {
    const user = this.currentUser.current;
    if (!user) return 'Belum login';
    // REQ-RDT-NAV-10 (TERJAWAB 1 Agu): sub-nav label for this queue is now "TAB", not
    // "Investigation/Ask TA" — matches the sidebar rename (shell.component.html).
    if (this.isInvestigation) return 'TAB';
    // A5 (3 Agu): chain arrow was missing everywhere except Dashboard-Detailing — when this
    // queue is scoped to one specific initiator (via Dashboard's ?from= param) and every loaded
    // row agrees on the same redirect path, show the full breadcrumb instead of a flat 2-point
    // label. Unscoped ("Semua dinas") or a mixed-path queue falls back to the plain label, same
    // "only show when unambiguous" rule dashboard.js's chain fields already use.
    if (this.filterFromDinas && this.pendingRows.length) {
      const scoped = this.pendingRows.filter((r) => r.dinas_inisiasi === this.filterFromDinas);
      const firstChain = scoped[0]?.chain;
      if (firstChain && firstChain.length > 2 && scoped.every((r) => JSON.stringify(r.chain) === JSON.stringify(firstChain))) {
        return firstChain.join(' → ');
      }
    }
    const from = this.filterFromDinas || 'Semua dinas';
    const target = this.selectedTarget === this.dinas ? user.display_name : this.selectedTarget;
    return `${from} → ${target}`;
  }

  // ---------- PENDING (checkbox model) ----------
  loadStatus(): void {
    this.statusError = '';
    this.emptyNote = '';
    this.justDeclined = [];
    this.justRedirected = [];
    this.confirmDescription = '';
    this.page = 1;
    this.activeQueueTab = 'pending';

    this.isInvestigation = this.selectedTarget === 'INVESTIGATION';
    if (this.isInvestigation) {
      this.loadInvestigation();
      return;
    }

    this.loadThread();
    if (!this.selectedTarget) return;
    this.confirmation.getPending(this.selectedTarget).subscribe({
      next: (rows) => {
        const filtered = this.filterFromDinas ? rows.filter((r) => r.dinas_inisiasi === this.filterFromDinas) : rows;
        this.pendingRows = filtered.map((r) => ({ ...r, checked: false, redirectTo: '' }));
        this.maybeSetEmptyNote();
      },
      error: (err) => { this.statusError = err?.message || 'Gagal memuat data pending'; },
    });
    // Declined-resolution list stays scoped to the user's OWN dinas as initiator — switching
    // the Confirmation target to Corp only changes which incoming queue is being confirmed, it
    // doesn't make the user an initiator of Corp's outgoing submissions.
    this.reassignment.getDeclined(this.dinas).subscribe({
      next: (rows) => { this.declinedRows = rows; this.maybeSetEmptyNote(); },
      error: (err) => { this.statusError = err?.message || 'Gagal memuat data declined'; },
    });
  }

  // ---------- Investigation/Ask TA sub-tab (REQ-RDT-LEDGER-10) ----------
  loadInvestigation(): void {
    this.investigationDescription = '';
    this.selectedInvestigationIds.clear();
    this.bulkTargetDinas = '';
    this.investigation.list().subscribe({
      next: (rows) => { this.investigationRows = rows; },
      error: (err) => { this.statusError = err?.message || 'Gagal memuat antrian investigasi'; },
    });
  }

  investigationDinasOptionsFor(row: InvestigationRow): DinasEntry[] {
    return this.dinasOptions.filter((d) => d.code.toUpperCase() !== String(row.dinas_inisiasi || '').toUpperCase());
  }

  async assignInvestigation(row: InvestigationRow): Promise<void> {
    const target = this.investigationTargetByRowId[row.id];
    if (!target) { await this.modal.alert('Pilih dinas target dulu.'); return; }
    const ok = await this.modal.confirm(`Assign baris ini ke dinas ${target}? Aksi ini FINAL — baris LANGSUNG berstatus Confirmed, dinas target tidak perlu konfirmasi ulang.`);
    if (!ok) return;
    const description = this.investigationDescription.trim() || undefined;
    this.investigation.assign(row.id, target, description).subscribe({
      next: async (dinasTarget) => {
        await this.modal.success('Baris di-assign ke ' + dinasTarget);
        this.loadInvestigation();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  // Same "must decide EVERY row before you can batch" gate the backend independently enforces
  // (routes/investigation.js's assign-all) — project owner: "kalo ada yang belum ditentukan mau
  // di-assign kemana itu ga bisa langsung assign semuanya".
  canAssignAllInvestigation(): boolean {
    return this.investigationRows.length > 0 && this.investigationRows.every((r) => !!this.investigationTargetByRowId[r.id]);
  }

  async assignAllInvestigation(): Promise<void> {
    if (!this.canAssignAllInvestigation()) return;
    const ok = await this.modal.confirm(`Assign ${this.investigationRows.length} baris sekaligus ke dinas yang sudah dipilih masing-masing? Aksi ini FINAL — semua baris LANGSUNG berstatus Confirmed.`);
    if (!ok) return;
    const items = this.investigationRows.map((r) => ({ transaction_id: r.id, dinas_target: this.investigationTargetByRowId[r.id] }));
    const description = this.investigationDescription.trim() || undefined;
    this.investigation.assignAll(items, description).subscribe({
      next: async () => {
        await this.modal.success('Semua baris sudah di-assign');
        this.loadInvestigation();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  // ---------- checkbox + Select All bulk-assign to one shared target (30 Jul addition) ----------
  isInvestigationSelected(rowId: number): boolean {
    return this.selectedInvestigationIds.has(rowId);
  }

  toggleInvestigationSelection(rowId: number, checked: boolean): void {
    if (checked) this.selectedInvestigationIds.add(rowId);
    else this.selectedInvestigationIds.delete(rowId);
  }

  get allInvestigationSelected(): boolean {
    const visible = this.filteredInvestigationRows;
    return visible.length > 0 && visible.every((r) => this.selectedInvestigationIds.has(r.id));
  }

  toggleSelectAllInvestigation(checked: boolean): void {
    if (checked) this.filteredInvestigationRows.forEach((r) => this.selectedInvestigationIds.add(r.id));
    else this.filteredInvestigationRows.forEach((r) => this.selectedInvestigationIds.delete(r.id));
  }

  // Dinas options valid for EVERY currently-selected row at once — excludes a dinas the moment
  // it's some selected row's own dinas_inisiasi (validateReassignTarget rejects target===inisiasi
  // server-side too), so the shared dropdown never offers a choice that would fail for part of
  // the selection.
  get bulkDinasOptions(): DinasEntry[] {
    const selectedInitiators = new Set(
      this.investigationRows.filter((r) => this.selectedInvestigationIds.has(r.id)).map((r) => String(r.dinas_inisiasi).toUpperCase())
    );
    return this.dinasOptions.filter((d) => !selectedInitiators.has(d.code.toUpperCase()));
  }

  canBulkAssignSelected(): boolean {
    return this.selectedInvestigationIds.size > 0 && !!this.bulkTargetDinas;
  }

  async bulkAssignSelected(): Promise<void> {
    if (!this.canBulkAssignSelected()) return;
    const count = this.selectedInvestigationIds.size;
    const target = this.bulkTargetDinas;
    const ok = await this.modal.confirm(`Assign ${count} baris terpilih ke dinas ${target}? Aksi ini FINAL — semua baris LANGSUNG berstatus Confirmed.`);
    if (!ok) return;
    const items = this.investigationRows
      .filter((r) => this.selectedInvestigationIds.has(r.id))
      .map((r) => ({ transaction_id: r.id, dinas_target: target }));
    const description = this.investigationDescription.trim() || undefined;
    this.investigation.assignAll(items, description).subscribe({
      next: async () => {
        await this.modal.success(`${count} baris sudah di-assign ke ${target}`);
        this.loadInvestigation();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  // Only meaningful filtered to ONE specific pair — "Semua dinas" (filterFromDinas unset) has no
  // single thread to show.
  get showThread(): boolean {
    return !!this.filterFromDinas && !!this.selectedTarget;
  }

  private loadThread(): void {
    this.threadRows = [];
    this.threadLoaded = false;
    if (!this.showThread) return;
    this.dashboardDetail.getComments(this.filterFromDinas!, this.selectedTarget).subscribe({
      next: (comments) => { this.threadRows = this.buildThreadRows(comments); this.threadLoaded = true; },
      error: () => { this.threadLoaded = true; /* best-effort — never block the confirmation flow */ },
    });
  }

  // Mirrors DashboardDetailComponent.buildThreadRows — flattens the parent/child comment tree
  // into depth-annotated rows for straightforward *ngFor rendering.
  private buildThreadRows(comments: Comment[]): ThreadRow[] {
    const byParent = new Map<number | 'root', Comment[]>();
    for (const c of comments) {
      const key = c.parent_comment_id ?? 'root';
      const list = byParent.get(key) || [];
      list.push(c);
      byParent.set(key, list);
    }
    const rows: ThreadRow[] = [];
    const walk = (parentKey: number | 'root', depth: number) => {
      for (const c of byParent.get(parentKey) || []) {
        rows.push({ comment: c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk('root', 0);
    return rows;
  }

  // Route-object navigation, not '../../' string tokens (28 Jul bug fix — see
  // HomeComponent.goToConfirmFrom's note; the same '../' hop-counting pattern threw NG04002 here
  // too). Walk up to the shell's own route (this.route.parent = 'confirm', .parent.parent = the
  // shell's '' route) and resolve 'dashboard/detail/...' relative to THAT.
  goToThreadDetail(): void {
    if (!this.filterFromDinas || !this.selectedTarget) return;
    const shellRoute = this.route.parent?.parent || this.route;
    this.router.navigate(['dashboard', 'detail', this.filterFromDinas, this.selectedTarget], { relativeTo: shellRoute });
  }

  private maybeSetEmptyNote(): void {
    if (!this.pendingRows.length && !this.declinedRows.length) {
      this.emptyNote = this.filterFromDinas
        ? `Tidak ada pengajuan dari ${this.filterFromDinas} yang menunggu tindakan Anda.`
        : 'Tidak ada pengajuan yang menunggu tindakan Anda saat ini.';
    } else {
      this.emptyNote = '';
    }
  }

  toggleSelectAll(checked: boolean): void {
    this.pendingRows.forEach((r) => (r.checked = checked));
  }

  // REQ-RDT-NAV-09: filter first, THEN paginate what's left.
  get filteredPendingRows(): PendingRowVm[] {
    return this.pendingRows.filter((r) => matchesAllColumnFilters(r, this.pendingColumnFilters, (row, key) => (row as any)[key]));
  }

  onPendingColumnFilterChange(key: string, values: string[]): void {
    if (values.length) this.pendingColumnFilters[key] = values;
    else delete this.pendingColumnFilters[key];
    this.page = 1;
  }

  // REQ-RDT-NAV-07: pagination for pendingRows via the shared pager component.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredPendingRows.length / this.pageSize));
  }

  get pagedPendingRows(): PendingRowVm[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredPendingRows.slice(start, start + this.pageSize);
  }

  onPageChange(p: number): void { this.page = p; }

  // REQ-RDT-UI-05 "Rincian per-hop" (4 Agu): a single transaction's own chain has no meaningful
  // "in progress" fraction per hop (it already fully traversed every hop to reach where it sits
  // now) — see shared/chain-hop-detail.component.ts's showProgress fallback, which this leaves
  // resolved/total undefined for on purpose.
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

  // Item 7: dinas choices for a pending row's "reject ke dinas lain" picker — same exclusion
  // rules as REASSIGN (can't send back to the uploader, can't "redirect" to the dinas that's
  // literally doing the rejecting right now).
  redirectTargetsFor(row: PendingRow): DinasEntry[] {
    const excluded = new Set([String(row.dinas_inisiasi || '').toUpperCase(), this.selectedTarget.toUpperCase()]);
    return this.dinasOptions.filter((d) => !excluded.has(d.code.toUpperCase()));
  }

  // REQ-RDT-LEDGER-09: one download button per distinct source upload feeding this queue — not
  // a single button, since one confirmation pair can be fed by more than one upload (different
  // months/periods). No separate "list available files" endpoint: the pending rows already
  // carry upload_id/upload_filename, so this just dedupes what's already loaded.
  get downloadableUploads(): { upload_id: number; upload_filename: string }[] {
    const seen = new Map<number, { upload_id: number; upload_filename: string }>();
    for (const r of this.pendingRows) {
      if (r.upload_id != null && !seen.has(r.upload_id)) {
        seen.set(r.upload_id, { upload_id: r.upload_id, upload_filename: r.upload_filename || `upload-${r.upload_id}.xlsx` });
      }
    }
    return Array.from(seen.values());
  }

  downloadOriginal(uploadId: number, filename: string): void {
    this.confirmation.downloadOriginal(uploadId, filename).subscribe({
      next: (blob) => triggerBlobDownload(blob, filename),
      error: async (err) => { await this.modal.alert('Gagal mengunduh file asli: ' + (err?.message || err)); },
    });
  }

  // REQ-RDT-LEDGER-09, extended 5 Agu ke antrian Investigation ("Ask TA") — sama pola dengan
  // downloadableUploads di atas, sumbernya investigationRows (yang juga sudah bawa
  // upload_id/upload_filename dari investigation.js), tetap pakai downloadOriginal() yang sama.
  get downloadableInvestigationUploads(): { upload_id: number; upload_filename: string }[] {
    const seen = new Map<number, { upload_id: number; upload_filename: string }>();
    for (const r of this.investigationRows) {
      if (r.upload_id != null && !seen.has(r.upload_id)) {
        seen.set(r.upload_id, { upload_id: r.upload_id, upload_filename: r.upload_filename || `upload-${r.upload_id}.xlsx` });
      }
    }
    return Array.from(seen.values());
  }

  async submitDecisions(): Promise<void> {
    if (!this.pendingRows.length) return;
    const confirmedCount = this.pendingRows.filter((r) => r.checked).length;
    const rejectedCount = this.pendingRows.length - confirmedCount;
    const redirectCount = this.pendingRows.filter((r) => !r.checked && r.redirectTo).length;
    const ok = await this.modal.confirm(
      `Apakah kamu sudah yakin? ${confirmedCount} transaksi akan DIKONFIRMASI (Ya), ${rejectedCount} transaksi TIDAK dicentang sehingga akan DITOLAK (Tidak)` +
      (redirectCount ? ` (${redirectCount} di antaranya langsung diarahkan ke dinas lain)` : '') +
      `. Tindakan ini akan mengubah status seluruh baris yang tampil dan membuat jurnal ledger.`
    );
    if (!ok) return;
    const decisions: { id: number; claim: ConfirmationClaim; redirect_to?: string }[] = this.pendingRows.map((r) => ({
      id: r.id,
      claim: r.checked ? 'YA' : 'TIDAK',
      redirect_to: !r.checked && r.redirectTo ? r.redirectTo : undefined,
    }));
    this.confirmation.submit(this.selectedTarget, decisions, this.confirmDescription).subscribe({
      next: async (outcome) => {
        this.confirmDescription = '';
        this.loadStatus();
        this.justDeclined = outcome.declined;
        this.justRedirected = outcome.redirected;
        const parts: string[] = [];
        if (outcome.declined.length) {
          parts.push(
            `${outcome.declined.length} transaksi ditolak dan dikembalikan ke dinas pengaju untuk ditindaklanjuti (Tanggung Sendiri / Ajukan ulang):\n` +
            outcome.declined.map((d) => `• ${d.account} — ${Number(d.nominal).toLocaleString('id-ID')} (${d.dinas_inisiasi})`).join('\n')
          );
        }
        if (outcome.redirected.length) {
          parts.push(
            `${outcome.redirected.length} transaksi langsung diarahkan ke dinas lain:\n` +
            outcome.redirected.map((d) => `• ${d.account} — ${Number(d.nominal).toLocaleString('id-ID')} → ${d.redirected_to}`).join('\n')
          );
        }
        await this.modal.alert(parts.length ? `Keputusan tersimpan.\n\n${parts.join('\n\n')}` : 'Keputusan tersimpan');
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  // ---------- DECLINED resolution (initiator side — items 7/10) ----------
  reassignTargetsFor(row: DeclinedRow): DinasEntry[] {
    const excluded = new Set([this.dinas.toUpperCase(), String(row.dinas_target).toUpperCase()]);
    return this.dinasOptions.filter((d) => !excluded.has(d.code.toUpperCase()));
  }

  async resolveBorne(row: DeclinedRow): Promise<void> {
    const ok = await this.modal.confirm('Apakah kamu sudah yakin?');
    if (!ok) return;
    this.reassignment.resolveBorne(row.id).subscribe({
      next: async () => { await this.modal.alert('Tersimpan'); this.loadStatus(); },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  async resolveReassign(row: DeclinedRow): Promise<void> {
    const target = this.reassignTargetByRowId[row.id];
    if (!target) { await this.modal.alert('Pilih dinas target dulu.'); return; }
    const ok = await this.modal.confirm('Apakah kamu sudah yakin?');
    if (!ok) return;
    this.reassignment.resolveReassign(row.id, target).subscribe({
      next: async () => { await this.modal.alert('Tersimpan'); this.loadStatus(); },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }

  // Item 10: stage a destination for a row (used by the "Confirm All" batch below) without
  // resolving it immediately.
  setPendingAction(row: DeclinedRow, action: 'BORNE' | 'REASSIGN' | ''): void {
    if (action) this.pendingActionByRowId[row.id] = action;
    else delete this.pendingActionByRowId[row.id];
  }

  get stagedCount(): number {
    return Object.keys(this.pendingActionByRowId).length;
  }

  canSubmitAll(): boolean {
    return this.declinedRows.some((r) => {
      const action = this.pendingActionByRowId[r.id];
      if (!action) return false;
      if (action === 'REASSIGN' && !this.reassignTargetByRowId[r.id]) return false;
      return true;
    });
  }

  async submitAllResolutions(): Promise<void> {
    const items = this.declinedRows
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
    this.reassignment.resolveBatch(items as any, this.batchNote).subscribe({
      next: async () => {
        this.pendingActionByRowId = {};
        this.batchNote = '';
        await this.modal.alert('Tersimpan');
        this.loadStatus();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }
}
