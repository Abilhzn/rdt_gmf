import { Component, ElementRef, Input, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
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
export class MentionInputComponent implements ControlValueAccessor {
  @Input() rows = 3;
  @Input() placeholder = 'Ketik @ untuk mention dinas atau orang...';
  /** Extra CSS class(es) merged onto the textarea, so each call site can keep its own
   * width/padding (repost-desc, reviewer-note-input, batch-note, ...) instead of every field in
   * the app looking identical. */
  @Input() extraClass = '';
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;

  value = '';
  showMentions = false;
  suggestions: MentionOption[] = [];
  highlightedIndex = -1;

  private onChangeFn: (v: string) => void = () => {};
  private onTouchedFn: () => void = () => {};

  constructor(private mentionSvc: MentionService) {}

  writeValue(v: string): void { this.value = v || ''; }
  registerOnChange(fn: (v: string) => void): void { this.onChangeFn = fn; }
  registerOnTouched(fn: () => void): void { this.onTouchedFn = fn; }

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
    const cursor = el.selectionStart ?? el.value.length;
    const upToCursor = el.value.slice(0, cursor);
    const match = /@([\w-]*)$/.exec(upToCursor);
    if (!match) { this.showMentions = false; return; }
    this.suggestions = this.mentionSvc.suggestionsFor(match[1]);
    this.showMentions = this.suggestions.length > 0;
    this.highlightedIndex = this.showMentions ? 0 : -1;
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
