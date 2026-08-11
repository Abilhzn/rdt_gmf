import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { MentionOption, MentionService } from '../services/mention.service';

// REQ-RDT-COMMENT-03 (diperluas 3 Agu): the ONE @mention-capable textarea, used everywhere a
// note/description field needs mention autocomplete — replaces the duplicated onDescriptionInput/
// onCommentKeydown/insertMention copies that used to live separately in
// RepostBudgetingComponent and DashboardDetailComponent, and adds the same capability to
// Confirmation's Confirm/Reject description, TAB's closing description (Need Approval), the
// Investigation assign note, and Catatan Reviewer — none of which had it before. ControlValueAccessor
// so it drops into existing [(ngModel)] bindings unchanged at every call site.
@Component({
  selector: 'rdt-mention-input',
  standalone: false,
  template: `
    <div class="mvi-wrap">
      <textarea
        #inputEl
        class="mvi-textarea"
        [class]="extraClass"
        [rows]="rows"
        [placeholder]="placeholder"
        [value]="value"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()"
      ></textarea>
      <ul class="mvi-list" *ngIf="showMentions">
        <li
          *ngFor="let o of suggestions; let i = index"
          [class.mvi-list__item--active]="i === highlightedIndex"
          (mouseenter)="highlightedIndex = i"
          (mousedown)="insertMention(o)"
        >@{{ o.token }} — {{ o.label }}</li>
      </ul>
    </div>
  `,
  styleUrls: ['./mention-input.component.scss'],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MentionInputComponent), multi: true }],
})
export class MentionInputComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  @Input() rows = 3;
  @Input() placeholder = 'Ketik @ untuk mention dinas atau orang...';
  /** Extra CSS class(es) merged onto the textarea, so each call site can keep its own
   * width/padding (repost-desc, reviewer-note-input, batch-note, ...) instead of every field in
   * the app looking identical. */
  @Input() extraClass = '';
  /** Feedback tambahan 7 Agu: defaults to the existing grow-to-fit-content behavior (added 3 Agu
   * specifically for Catatan Reviewer's "no scroll, ever" requirement) — but the `.batch-note`
   * call sites (Confirmation/Need Approval/Share-Cost's "Deskripsi (opsional)" and friends) want
   * the OPPOSITE: a fixed box matching the surrounding layout, with internal scroll for long text.
   * Set `false` at those call sites; every other existing use is untouched by default. */
  @Input() autoGrow = true;
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;

  value = '';
  showMentions = false;
  suggestions: MentionOption[] = [];
  highlightedIndex = -1;

  private onChangeFn: (v: string) => void = () => {};
  private onTouchedFn: () => void = () => {};

  // 500ms debounce on the autocomplete lookup itself (project owner request, 5 Agu: debounce
  // "fitur search apapun, terutama mention/tagging"). Typing into the textarea (this.value,
  // autoGrow, onChangeFn) stays fully instant -- only the token->suggestions query and the popup
  // update are delayed. HIDING the popup (no "@token" under the cursor anymore) is deliberately
  // NOT debounced below, so the list disappears immediately once it's no longer relevant instead
  // of lingering for up to 500ms after the user has already moved on.
  private readonly mentionQuery$ = new Subject<string>();
  private mentionQuerySub?: Subscription;

  constructor(private mentionSvc: MentionService) {
    this.mentionQuerySub = this.mentionQuery$.pipe(debounceTime(500)).subscribe((token) => {
      this.suggestions = this.mentionSvc.suggestionsFor(token);
      this.showMentions = this.suggestions.length > 0;
      this.highlightedIndex = this.showMentions ? 0 : -1;
    });
  }

  ngOnDestroy(): void {
    this.mentionQuerySub?.unsubscribe();
  }

  writeValue(v: string): void {
    this.value = v || '';
    // A pre-filled value (writeValue can run before ngAfterViewInit, e.g. an already-typed
    // Catatan Reviewer note surviving a page filter change) needs the same auto-grow as typing —
    // inputEl may not exist yet on the very first call, ngAfterViewInit below covers that case.
    // Skip when empty: an empty textarea has nothing to measure, and forcing an inline height at
    // that point risks fighting the [rows] attribute's own natural sizing for no benefit.
    if (this.autoGrow && this.inputEl && this.value) setTimeout(() => this.autoGrow_(this.inputEl!.nativeElement));
  }
  registerOnChange(fn: (v: string) => void): void { this.onChangeFn = fn; }
  registerOnTouched(fn: () => void): void { this.onTouchedFn = fn; }

  ngAfterViewInit(): void {
    if (this.autoGrow && this.inputEl && this.value) this.autoGrow_(this.inputEl.nativeElement);
  }

  // REQ-RDT-NAV-04 (3 Agu, "Catatan Reviewer" bug): field must be fully readable with NO scroll —
  // a fixed row-count textarea with overflow:hidden either clips long text or needs a scrollbar,
  // both violate that. Auto-growing the height to fit content on every keystroke (the standard
  // "shadow textarea" trick, minus the shadow element since we can just measure scrollHeight
  // directly) means overflow:hidden never actually hides anything.
  private autoGrow_(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  /** For call sites that used to auto-focus their own <textarea> (e.g. clicking "Balas" on a
   * comment) — the textarea now lives inside this component, not directly reachable via the
   * parent's own @ViewChild. */
  focus(): void {
    this.inputEl?.nativeElement.focus();
  }

  onInput(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement;
    this.value = el.value;
    this.onChangeFn(this.value);
    if (this.autoGrow) this.autoGrow_(el);
    const cursor = el.selectionStart ?? el.value.length;
    const upToCursor = el.value.slice(0, cursor);
    const match = /@([\w-]*)$/.exec(upToCursor);
    if (!match) { this.showMentions = false; return; }
    this.mentionQuery$.next(match[1]);
  }

  onKeydown(ev: KeyboardEvent): void {
    if (!this.showMentions || !this.suggestions.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.highlightedIndex = (this.highlightedIndex + 1) % this.suggestions.length;
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.highlightedIndex = (this.highlightedIndex - 1 + this.suggestions.length) % this.suggestions.length;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const option = this.suggestions[this.highlightedIndex];
      if (option) this.insertMention(option);
    } else if (ev.key === 'Escape') {
      this.showMentions = false;
    }
  }

  insertMention(option: MentionOption): void {
    const el = this.inputEl?.nativeElement;
    if (!el) return;
    const cursor = el.selectionStart ?? this.value.length;
    const upToCursor = this.value.slice(0, cursor);
    const afterCursor = this.value.slice(cursor);
    const replaced = upToCursor.replace(/@([\w-]*)$/, `@${option.token} `);
    this.value = replaced + afterCursor;
    this.onChangeFn(this.value);
    this.showMentions = false;
    const newCursor = replaced.length;
    setTimeout(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  }

  onBlur(): void {
    this.onTouchedFn();
    // Delay so a mousedown on a suggestion registers before the list disappears (blur fires first).
    setTimeout(() => { this.showMentions = false; }, 150);
  }
}
