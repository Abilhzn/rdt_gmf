import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { RepostService } from '../services/repost.service';
import { Transaction } from '../../../shared/models/transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { ModalService } from '../../../services/modal.service';
import { extractErrorMessage } from '../../../core/utils/error-message.util';

type UiPhase = 'idle' | 'parsing' | 'parsed' | 'committing' | 'committed' | 'error';

/** SMART page — orchestrates upload → parse → review → persist. Preview filtering/pagination
 * lives in `PreviewTableComponent` (dumb child); this only owns upload/persist state. */
@Component({
  selector: 'app-repost-budgeting-page',
  standalone: false,
  templateUrl: './repost-budgeting-page.component.html',
  styleUrls: ['./repost-budgeting-page.component.scss'],
})
export class RepostBudgetingPageComponent implements OnInit, OnDestroy {
  phase: UiPhase = 'idle';
  errorMessage = '';

  selectedFile: File | null = null;
  /** item 6: optional free-text note attached to the upload record, not a required field */
  description = '';

  rows: Transaction[] = [];

  private userSub?: Subscription;
  private isFirstUserEmission = true;

  constructor(
    private repost: RepostService,
    public currentUser: CurrentUserService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    // Item 3: switching "Login sebagai" must not leave one user's parsed rows/description/
    // success state visible to whoever logs in next — reset whenever the account changes.
    // Skip the very first emission (component's own initial load) so this doesn't clobber
    // anything before the user has done anything.
    this.userSub = this.currentUser.user$.subscribe(() => {
      if (this.isFirstUserEmission) { this.isFirstUserEmission = false; return; }
      this.reset();
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  // ---------- file selection ----------
  onFileSelected(f: File): void {
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      this.phase = 'error';
      this.errorMessage = 'Format file harus .xlsx. File yang dipilih: ' + f.name;
      return;
    }
    this.selectedFile = f;
    this.phase = 'idle';
    this.errorMessage = '';
  }

  // ---------- actions ----------
  parse(): void {
    if (!this.selectedFile) return;
    this.phase = 'parsing';
    this.errorMessage = '';
    this.repost.uploadAndParse(this.selectedFile).subscribe({
      next: (res) => {
        this.rows = res.rows || [];
        this.phase = 'parsed';
      },
      error: (err) => {
        this.phase = 'error';
        this.errorMessage = extractErrorMessage(err, 'Gagal memproses file Excel.');
      },
    });
  }

  async commit(): Promise<void> {
    if (!this.rows.length) return;
    this.phase = 'committing';
    // reviewer_note persists as-is (migration 015) — Confirmation's sticky "Notes" column reads
    // this same field. periode is not chosen here — the server derives it in POST persist.
    this.repost.persist(this.rows, this.selectedFile, this.description).subscribe({
      next: async () => {
        this.phase = 'committed';
        // Item 2: animated checkmark instead of an inline "Data tersimpan ke staging" line.
        // Item 3: reset right after, so this submitter's rows/file/description don't linger on
        // screen for whoever uses this browser session next.
        await this.modal.success('Repost berhasil diajukan!');
        this.reset();
      },
      error: (err) => {
        this.phase = 'error';
        this.errorMessage = extractErrorMessage(err, 'Gagal menyimpan ke staging.');
      },
    });
  }

  reset(): void {
    this.phase = 'idle';
    this.errorMessage = '';
    this.selectedFile = null;
    this.description = '';
    this.rows = [];
  }
}
