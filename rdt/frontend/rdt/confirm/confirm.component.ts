import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ConfirmationService, PendingRow, ConfirmationClaim, DeclinedOutcomeRow, RedirectedOutcomeRow, triggerBlobDownload } from '../services/confirmation.service';
import { ReassignmentService, DeclinedRow } from '../services/reassignment.service';
import { DinasService, DinasEntry } from '../services/dinas.service';
import { ModalService } from '../services/modal.service';
import { DashboardDetailService } from '../services/dashboard-detail.service';
import { Comment } from '../services/comment.model';

interface PendingRowVm extends PendingRow {
  checked: boolean;
  /** '' = balik ke pengaju (default DECLINED flow); a dinas code = reject-and-redirect there
   * immediately (item 7). Only meaningful when checked=false. */
  redirectTo: string;
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
   * now knows the REAL queue a submission sits in (TAB's own dinas, or 'Corp'/'TA' — neither has
   * a dedicated PIC, REQ-RDT-AUTH-04). Without it, selectedTarget falls back to the user's own
   * dinas as before. Bug fixed 28 Jul: TA-targeted rows used to be reachable from the dashboard
   * card but the queue always defaulted to the user's own dinas regardless, so they never
   * actually showed up to confirm. */
  filterTargetDinas: string | null = null;
  pendingRows: PendingRowVm[] = [];
  declinedRows: DeclinedRow[] = [];
  dinasOptions: DinasEntry[] = [];

  statusError = '';
  emptyNote = '';
  reassignTargetByRowId: Record<number, string> = {};

  // REQ-RDT-NAV-07: paginate the pending table instead of dumping every row on one page, using
  // the shared pager (100 rows/page) also used by Repost's review table.
  page = 1;
  readonly pageSize = 100;

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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public currentUser: CurrentUserService,
    private confirmation: ConfirmationService,
    private reassignment: ReassignmentService,
    private dinasService: DinasService,
    private dashboardDetail: DashboardDetailService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.dinasService.getActiveDinas().subscribe((d) => (this.dinasOptions = d));
    this.currentUser.user$.subscribe(() => this.resolveDinasAndLoad());
    this.route.queryParamMap.subscribe((params) => {
      this.filterFromDinas = params.get('from');
      this.filterTargetDinas = params.get('target');
      this.resolveDinasAndLoad();
    });
  }

  private resolveDinasAndLoad(): void {
    const user = this.currentUser.current;
    this.dinas = user?.dinas || '';
    // ?target= overrides the default "my own dinas" queue — see filterTargetDinas's comment.
    this.selectedTarget = this.filterTargetDinas || this.dinas;
    if (this.dinas) this.loadStatus();
  }

  get targetOptions(): string[] {
    const role = this.currentUser.current?.role;
    if (role === 'TAB') return [this.dinas, 'Corp', 'TA'];
    return [this.dinas];
  }

  onTargetChange(): void {
    this.loadStatus();
  }

  get badgeText(): string {
    const user = this.currentUser.current;
    if (!user) return 'Belum login';
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

  // REQ-RDT-NAV-07: pagination for pendingRows via the shared pager component.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.pendingRows.length / this.pageSize));
  }

  get pagedPendingRows(): PendingRowVm[] {
    const start = (this.page - 1) * this.pageSize;
    return this.pendingRows.slice(start, start + this.pageSize);
  }

  onPageChange(p: number): void { this.page = p; }

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
