import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, TransactionStatus, AggregationMatrix } from '../../services/transaction.model';
import { CurrentUserService } from '@auth/services/current-user.service';
import { DinasService } from '../../services/dinas.service';
import { ModalService } from '../../services/modal.service';
import { matchesAnyFilterValue } from '../../shared/multi-value-filter.component';

type UiPhase = 'idle' | 'parsing' | 'parsed' | 'committing' | 'committed' | 'error';

interface MentionOption {
  /** what actually gets inserted after "@" — must stay a single \w-ish token, no spaces */
  token: string;
  /** what's shown in the dropdown so entries are distinguishable */
  label: string;
}

@Component({
  selector: 'app-repost-budgeting',
  standalone: false,
  templateUrl: './repost-budgeting.component.html',
  styleUrls: ['./repost-budgeting.component.scss'],
})
export class RepostBudgetingComponent implements OnInit, OnDestroy {
  phase: UiPhase = 'idle';
  errorMessage = '';

  selectedFile: File | null = null;
  isDragOver = false;
  /** item 6: optional free-text note attached to the upload record, not a required field */
  description = '';

  // Item 5: @mention a dinas OR a specific user in the description, like tagging on social
  // media. `token` is what actually gets inserted (must stay a single \w-ish word, no spaces,
  // to keep the trailing "@partial" regex match working); `label` is what's shown in the
  // dropdown so the user can tell entries apart.
  @ViewChild('descInput') descInput?: ElementRef<HTMLTextAreaElement>;
  mentionOptions: MentionOption[] = [];
  mentionSuggestions: MentionOption[] = [];
  showMentions = false;
  highlightedMentionIndex = -1;

  rows: Transaction[] = [];
  aggregation: AggregationMatrix = {};

  /** filter state */
  statusFilter: TransactionStatus | 'ALL' = 'ALL';
  dinasFilter = 'ALL';
  searchText = '';
  /** REQ-RDT-NAV-09: paste-many-values filter on Account, ala SAP — see
   * shared/multi-value-filter.component.ts for the reusable paste box + matching rules. */
  accountFilterValues: string[] = [];

  /** REQ-RDT-NAV-07: pagination sederhana client-side, 100 baris/halaman, pager reusable
   * (shared/pagination.component.ts) yang juga dipakai di Confirmation. */
  page = 1;
  readonly pageSize = 100;

  private userSub?: Subscription;
  private isFirstUserEmission = true;

  constructor(
    private txService: TransactionService,
    public currentUser: CurrentUserService,
    dinasService: DinasService,
    private modal: ModalService,
  ) {
    // Item 1: mentions cover every dinas AND every user, not just dinas codes.
    dinasService.getActiveDinas().subscribe((dinasList) => {
      const dinasOptions: MentionOption[] = dinasList.map((d) => ({ token: d.code, label: `${d.code} — ${d.name}` }));
      this.mentionOptions = [...dinasOptions, ...this.mentionOptions.filter((o) => !dinasOptions.some((d) => d.token === o.token))];
    });
    this.currentUser.loadDirectory().subscribe((directory) => {
      const userOptions: MentionOption[] = Object.entries(directory).map(([id, entry]) => ({ token: id, label: `${entry.display_name} (${entry.dinas})` }));
      this.mentionOptions = [...this.mentionOptions, ...userOptions];
    });
  }

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

  // ---------- @mention (item 5) ----------
  // Detects "@partial-word" immediately before the cursor and shows matching dinas/user
  // options — matched against BOTH the insertable token and the human-readable label, same
  // interaction as tagging someone on social media.
  //
  // Bug fix (live testing, 24 Jul): capped at 8 like ui-demo.html originally was, but with 21
  // dinas + ~24 directory users to match against, 8 was too few to reliably find someone by
  // scanning alone — raised to 20 (the dropdown box already scrolls, .mention-list's
  // max-height/overflow-y in the scss). Also added arrow-key navigation + Enter-to-select,
  // which neither app had at all before — mouse-only wasn't enough for a list this size.
  onDescriptionInput(): void {
    const el = this.descInput?.nativeElement;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const upToCursor = el.value.slice(0, cursor);
    const match = /@([\w-]*)$/.exec(upToCursor);
    if (!match) { this.showMentions = false; return; }
    const query = match[1].toLowerCase();
    this.mentionSuggestions = this.mentionOptions
      .filter((o) => o.token.toLowerCase().includes(query) || o.label.toLowerCase().includes(query))
      .slice(0, 20);
    this.showMentions = this.mentionSuggestions.length > 0;
    this.highlightedMentionIndex = this.showMentions ? 0 : -1;
  }

  onDescriptionKeydown(event: KeyboardEvent): void {
    if (!this.showMentions || !this.mentionSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedMentionIndex = (this.highlightedMentionIndex + 1) % this.mentionSuggestions.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedMentionIndex = (this.highlightedMentionIndex - 1 + this.mentionSuggestions.length) % this.mentionSuggestions.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = this.mentionSuggestions[this.highlightedMentionIndex];
      if (option) this.insertMention(option);
    } else if (event.key === 'Escape') {
      this.showMentions = false;
    }
  }

  insertMention(option: MentionOption): void {
    const el = this.descInput?.nativeElement;
    if (!el) return;
    const cursor = el.selectionStart ?? this.description.length;
    const upToCursor = this.description.slice(0, cursor);
    const afterCursor = this.description.slice(cursor);
    const replaced = upToCursor.replace(/@([\w-]*)$/, `@${option.token} `);
    this.description = replaced + afterCursor;
    this.showMentions = false;
    const newCursor = replaced.length;
    setTimeout(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  }

  closeMentions(): void {
    // Delay so a click on a suggestion registers before the list disappears (blur fires first).
    setTimeout(() => { this.showMentions = false; }, 150);
  }

  // ---------- file selection ----------
  onFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) this.setFile(input.files[0]);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = false;
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.setFile(f);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  private setFile(f: File): void {
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
    this.txService
      .uploadAndParse(this.selectedFile)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            this.phase = 'error';
            this.errorMessage = res.error || 'Parse gagal tanpa pesan error.';
            return;
          }
          this.rows = res.rows || [];
          this.aggregation = res.aggregation || {};
          this.page = 1;
          this.phase = 'parsed';
        },
        error: (err) => {
          this.phase = 'error';
          this.errorMessage = err?.error?.error || err?.message || 'Gagal menghubungi server.';
        },
      });
  }

  commit(): void {
    if (!this.rows.length) return;
    this.phase = 'committing';
    this.txService
      .persistToDatabase(this.rows, this.aggregation, this.selectedFile, this.description)
      .subscribe({
        next: async (res) => {
          if (!res.ok) {
            this.phase = 'error';
            this.errorMessage = res.error || 'Simpan gagal tanpa pesan error.';
            return;
          }
          this.phase = 'committed';
          // Item 2: animated checkmark instead of an inline "Data tersimpan ke staging" line.
          // Item 3: reset right after, so this submitter's rows/file/description don't linger
          // on screen for whoever uses this browser session next.
          await this.modal.success('Repost berhasil diajukan!');
          this.reset();
        },
        error: (err) => {
          this.phase = 'error';
          this.errorMessage = err?.error?.error || err?.message || 'Gagal menyimpan ke staging.';
        },
      });
  }

  reset(): void {
    this.phase = 'idle';
    this.errorMessage = '';
    this.selectedFile = null;
    this.description = '';
    this.rows = [];
    this.aggregation = {};
    this.statusFilter = 'ALL';
    this.dinasFilter = 'ALL';
    this.searchText = '';
    this.accountFilterValues = [];
    this.page = 1;
  }

  // ---------- derived state untuk template ----------
  get statusCounts(): Record<string, number> {
    const c: Record<string, number> = { PENDING: 0, EXCLUDED: 0, INVALID: 0 };
    for (const r of this.rows) c[r.status_konfirmasi] = (c[r.status_konfirmasi] || 0) + 1;
    return c;
  }

  get aggregationCategories(): string[] {
    return Object.keys(this.aggregation).sort();
  }

  get aggregationDinasList(): string[] {
    const set = new Set<string>();
    Object.values(this.aggregation).forEach((byDinas) =>
      Object.keys(byDinas).forEach((d) => set.add(d)),
    );
    return Array.from(set).sort();
  }

  aggValue(category: string, dinas: string): number | null {
    const v = this.aggregation?.[category]?.[dinas];
    return typeof v === 'number' ? v : null;
  }

  get dinasOptions(): string[] {
    const set = new Set<string>();
    this.rows.forEach((r) => { if (r.dinas_target) set.add(r.dinas_target); });
    return Array.from(set).sort();
  }

  get filteredRows(): Transaction[] {
    const q = this.searchText.trim().toLowerCase();
    return this.rows.filter((r) => {
      if (this.statusFilter !== 'ALL' && r.status_konfirmasi !== this.statusFilter) return false;
      if (this.dinasFilter !== 'ALL' && r.dinas_target !== this.dinasFilter) return false;
      if (!matchesAnyFilterValue(r.account, this.accountFilterValues)) return false;
      if (q) {
        const hay = `${r.account || ''} ${r.remark || ''} ${r.category || ''} ${r.sheet || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  onAccountFilterChange(values: string[]): void {
    this.accountFilterValues = values;
    this.onFilterChange();
  }

  get pagedRows(): Transaction[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  onPageChange(p: number): void { this.page = p; }

  onFilterChange(): void { this.page = 1; }

  statusClass(s: TransactionStatus): string {
    return 'chip chip--' + s.toLowerCase();
  }

  trackByIndex(i: number): number { return i; }
}
