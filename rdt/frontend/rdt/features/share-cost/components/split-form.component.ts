import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { SplitCandidate, SplitLine } from '../services/share-cost.service';
import { DinasEntry } from '../../../services/dinas.service';
import { splitSumDiffCents } from '../services/split-sum.util';

interface SplitRowVm {
  dinas_target: string;
  nominal: number | null;
}

/** Dumb: the split form for one selected candidate row — N (dinas_target, nominal) rows with a
 * running-total validator against the original nominal. No HTTP — emits the composed payload on
 * `submitSplit`, the page owns `ShareCostService`. Resets its own staged rows whenever a new
 * `selected` candidate comes in (`ngOnChanges`). */
@Component({
  selector: 'rdt-split-form',
  standalone: false,
  templateUrl: './split-form.component.html',
})
export class SplitFormComponent implements OnChanges {
  @Input() selected: SplitCandidate | null = null;
  @Input() dinasOptions: DinasEntry[] = [];
  @Input() submitting = false;
  @Output() submitSplit = new EventEmitter<{ splits: SplitLine[]; note: string }>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() downloadOriginal = new EventEmitter<void>();

  splitRows: SplitRowVm[] = [];
  note = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['selected']) return;
    const row = this.selected;
    this.note = '';
    // Start with 2 blank rows — the original's own (dinas_target, nominal) is a natural first
    // guess for one of them, matching the SRS example (TH keeps 35rb of its original 100rb).
    this.splitRows = row ? [{ dinas_target: row.dinas_target, nominal: null }, { dinas_target: '', nominal: null }] : [];
  }

  addSplitRow(): void {
    this.splitRows.push({ dinas_target: '', nominal: null });
  }

  removeSplitRow(index: number): void {
    if (this.splitRows.length <= 2) return;
    this.splitRows.splice(index, 1);
  }

  get sumNominal(): number {
    return this.splitRows.reduce((acc, r) => acc + (r.nominal || 0), 0);
  }

  get sumDiff(): number {
    return splitSumDiffCents(this.splitRows, this.selected?.nominal ?? null) / 100;
  }

  get sumMatches(): boolean {
    return this.sumDiff === 0;
  }

  canSubmit(): boolean {
    if (!this.selected || this.submitting) return false;
    if (!this.note.trim()) return false;
    if (this.splitRows.length < 2) return false;
    if (!this.sumMatches) return false;
    return this.splitRows.every((r) => !!r.dinas_target && typeof r.nominal === 'number' && r.nominal !== 0);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const splits = this.splitRows.map((r) => ({ dinas_target: r.dinas_target, nominal: r.nominal as number }));
    this.submitSplit.emit({ splits, note: this.note.trim() });
  }
}
