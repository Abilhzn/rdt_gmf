import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ConfirmationClaim, ConfirmationService, DeclinedOutcomeRow, RedirectedOutcomeRow, triggerBlobDownload } from '../services/confirmation.service';
import { DeclinedRow, ReassignmentService } from '../services/reassignment.service';
import { InvestigationRow, InvestigationService } from '../services/investigation.service';
import { CommentThreadService } from '../services/comment-thread.service';
import { DinasEntry, DinasService } from '../../../services/dinas.service';
import { ModalService } from '../../../services/modal.service';
import { Comment } from '../../../shared/models/comment.model';
import { extractErrorMessage } from '../../../core/utils/error-message.util';
import { OriginalFileDownloadService } from '../../../core/services/original-file-download.service';
import { PendingRowVm, PreviewColumn } from '../components/pending-queue.component';

/** Format CBO's 12 columns are fixed — no more `GET /api/contract-fields` (53-column contract is
 * gone), same hardcoded-columns move as Repost Review (Batch 6b). "Dinas Pengaju" isn't here —
 * this queue already renders that separately (with its own chain-popover per-hop, see
 * pending-queue.component). The sticky rightmost column is `reviewer_note` ("Notes" — the
 * uploading user's own per-row note from Repost Review), not `remark` (raw Excel routing text). */
const PREVIEW_COLUMNS: PreviewColumn[] = [
  { key: 'account', label: 'Account' },
  { key: 'profit_ctr', label: 'Profit Ctr' },
  { key: 'ref_doc', label: 'Ref.Doc.' },
  { key: 'period', label: 'Period' },
  { key: 'text_desc', label: 'Text' },
  { key: 'material', label: 'Material' },
  { key: 'in_pclc', label: 'Value (In PCLC)', numeric: true },
  { key: 'category', label: 'Group' },
  { key: 'remark', label: 'Remark' },
  { key: 'reviewer_note', label: 'Notes' },
];

/** SMART page — orchestrates the Confirmation module: which queue is loaded (PENDING / DECLINED /
 * Investigation), fetches every list, and owns the handful of cross-cutting concerns (badge text,
 * thread preview, submit) that don't fit any one sub-panel. Ported from the old monolithic
 * `confirm.component.ts` (994 lines across .ts+.html — 6 backend concepts in one file) — table/
 * panel markup moved to dumb children (`pending-queue`, `declined-resolution`,
 * `investigation-panel`, `comment-thread`), state/orchestration stayed here since almost every
 * piece of it (badgeText, the submit button, the tab toggle) is genuinely cross-cutting. */
@Component({
  selector: 'app-confirm-page',
  standalone: false,
  templateUrl: './confirm-page.component.html',
  styleUrls: ['./confirm-page.component.scss'],
})
export class ConfirmPageComponent implements OnInit {
  dinas = '';
  /** Which target queue is loaded. Equals the user's own dinas, except for role TAB, who
   * additionally staffs dinas "Corp" (no dedicated PIC, TAB acts on its behalf, but the label
   * stays "Corp" everywhere). TAB gets a picker to switch between their own queue and Corp's. */
  selectedTarget = '';
  filterFromDinas: string | null = null;
  filterTargetDinas: string | null = null;

  pendingRows: PendingRowVm[] = [];
  declinedRows: DeclinedRow[] = [];
  dinasOptions: DinasEntry[] = [];
  readonly previewColumns = PREVIEW_COLUMNS;

  activeQueueTab: 'pending' | 'declined' = 'pending';
  statusError = '';
  emptyNote = '';

  submittingDecisions = false;
  justDeclined: DeclinedOutcomeRow[] = [];
  justRedirected: RedirectedOutcomeRow[] = [];
  confirmDescription = '';

  threadRows: Comment[] = [];
  threadLoaded = false;

  isInvestigation = false;
  investigationRows: InvestigationRow[] = [];

  private isFirstUserEmission = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public currentUser: CurrentUserService,
    private confirmation: ConfirmationService,
    private reassignment: ReassignmentService,
    private dinasService: DinasService,
    private investigation: InvestigationService,
    private commentThread: CommentThreadService,
    private modal: ModalService,
    private originalFile: OriginalFileDownloadService,
  ) {}

  // combineLatest, not two separate subscriptions: user$ (a BehaviorSubject) fires synchronously
  // the moment it's subscribed, before a queryParamMap subscription would exist yet — so a
  // separate subscription would call resolveDinasAndLoad() with filterFromDinas/filterTargetDinas
  // still unset, racing an HTTP request for the WRONG queue. combineLatest fires once per actual
  // change with BOTH inputs already current, so there's only ever one load in flight.
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
    // sub-nav (TAB-only). Without it: TAB defaults to 'Corp' (dinas_target can never literally be
    // 'TAB', so falling back to this.dinas would always show an empty queue for TAB); a plain PIC
    // defaults to their own.
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
    if (this.isInvestigation) return 'TAB';
    // When this queue is scoped to one specific initiator (via Dashboard's ?from= param) and
    // every loaded row agrees on the same redirect path, show the full breadcrumb instead of a
    // flat 2-point label. Unscoped ("Semua dinas") or a mixed-path queue falls back to the plain
    // label — only show the chain when it's unambiguous.
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

  selectQueueTab(tab: 'pending' | 'declined'): void {
    this.activeQueueTab = tab;
  }

  // ---------- PENDING (checkbox model) ----------
  loadStatus(): void {
    this.statusError = '';
    this.emptyNote = '';
    this.justDeclined = [];
    this.justRedirected = [];
    this.confirmDescription = '';
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
        this.pendingRows = filtered.map((r) => ({ ...r, checked: false, redirectTo: '' }) as PendingRowVm);
        this.maybeSetEmptyNote();
      },
      error: (err) => { this.statusError = extractErrorMessage(err, 'Gagal memuat data pending'); },
    });
    // Declined-resolution list stays scoped to the user's OWN dinas as initiator — switching the
    // Confirmation target to Corp only changes which incoming queue is being confirmed, it
    // doesn't make the user an initiator of Corp's outgoing submissions.
    this.reassignment.getDeclined(this.dinas).subscribe({
      next: (rows) => { this.declinedRows = rows; this.maybeSetEmptyNote(); },
      error: (err) => { this.statusError = extractErrorMessage(err, 'Gagal memuat data declined'); },
    });
  }

  // ---------- Investigation/Ask TA sub-tab ----------
  loadInvestigation(): void {
    this.investigation.list().subscribe({
      next: (rows) => { this.investigationRows = rows; },
      error: (err) => { this.statusError = extractErrorMessage(err, 'Gagal memuat antrian investigasi'); },
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
    this.commentThread.getComments(this.filterFromDinas!, this.selectedTarget).subscribe({
      next: (comments) => { this.threadRows = comments; this.threadLoaded = true; },
      error: () => { this.threadLoaded = true; /* best-effort — never block the confirmation flow */ },
    });
  }

  // Route-object navigation, not '../../' string tokens (NG04002 hop-counting pitfall). Walk up
  // to the shell's own route (this.route.parent = 'confirm', .parent.parent = the shell's ''
  // route) and resolve 'dashboard/detail/...' from there.
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

  downloadOriginal(uploadId: number, filename: string): void {
    this.originalFile.downloadOriginal(uploadId).subscribe({
      next: (blob) => triggerBlobDownload(blob, filename),
      error: async (err) => { await this.modal.alert('Gagal mengunduh file asli: ' + extractErrorMessage(err, String(err))); },
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
    this.submittingDecisions = true;
    this.confirmation.submit(this.selectedTarget, decisions, this.confirmDescription).subscribe({
      next: async (outcome) => {
        this.submittingDecisions = false;
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
      error: async (err) => { this.submittingDecisions = false; await this.modal.alert('Gagal menyimpan keputusan: ' + extractErrorMessage(err, String(err))); },
    });
  }
}
