import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

// REQ-RDT-NAV-09 (31 Jul, "filter multi-value ala SAP") — Excel-style: a small funnel button
// sits in the column header itself (next to the header text, not a separate box above the whole
// table); clicking it opens a popup with the paste textarea, positioned under that column.
// Project owner correction (31 Jul): the earlier "one paste box above the table" layout wasn't
// what was asked for — this is per-column, like Excel's own column filter buttons.
//
// One instance per filterable column. Same "write it once, reuse everywhere" rationale as
// PaginationComponent (REQ-RDT-NAV-07) — see that component's header comment for why. This
// component only owns the button + popup + parsing; each page keeps its own filtering (different
// columns, different row shapes) using matchesAnyFilterValue below against the values this emits.
@Component({
  selector: 'rdt-multi-value-filter',
  standalone: false,
  templateUrl: './multi-value-filter.component.html',
  styleUrls: ['./multi-value-filter.component.scss'],
})
export class MultiValueFilterComponent {
  @Input() placeholder = 'Tempel nilai di sini (satu per baris atau pisah koma)...';
  @Output() valuesChange = new EventEmitter<string[]>();

  open = false;
  raw = '';
  values: string[] = [];

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  get active(): boolean {
    return this.values.length > 0;
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.open = !this.open;
    if (this.open) this.raw = this.values.join('\n');
  }

  apply(): void {
    this.values = parseMultiValueFilter(this.raw);
    this.valuesChange.emit(this.values);
    this.open = false;
  }

  clear(event: MouseEvent): void {
    event.stopPropagation();
    this.raw = '';
    this.values = [];
    this.valuesChange.emit(this.values);
    this.open = false;
  }

  // Closes on any click outside this component — same pattern shell.component.ts uses for its
  // user/notification dropdowns.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    if (!this.elementRef.nativeElement.contains(event.target as Node)) this.open = false;
  }

  // Stop clicks inside the popup itself from bubbling to the document listener above (would
  // otherwise close the popup on every keystroke's containing click, e.g. clicking into the
  // textarea).
  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}

// Parsing: split on newline AND comma (SAP-style paste can come as either), trim whitespace off
// each value, drop empties, dedupe — REQ-RDT-NAV-09's exact wording.
export function parseMultiValueFilter(raw: string): string[] {
  const parts = String(raw || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(parts));
}

// No active filter (empty values) means "show everything" — every call site's row predicate
// should short-circuit through this rather than reimplementing the empty-means-all-pass rule.
// Match is case-insensitive/trimmed exact-match (SAP-paste semantics: pasted account numbers,
// ref docs, etc. are exact identifiers, not free-text search terms).
export function matchesAnyFilterValue(cellValue: string | number | null | undefined, values: string[]): boolean {
  if (!values.length) return true;
  const normalized = String(cellValue ?? '').trim().toUpperCase();
  return values.some((v) => v.trim().toUpperCase() === normalized);
}

// REQ-RDT-NAV-09 (diperluas 1 Agu): one filter box per COLUMN, not just one (e.g. Account) —
// combine as AND across columns (a row must satisfy every column that has an active filter),
// OR within one column (matchesAnyFilterValue's existing rule, untouched). `filters` is keyed by
// whatever column-key convention the caller uses; `getCellValue` reads that key off a row. Every
// table that adopts per-column filtering shares this one function instead of hand-rolling its
// own AND-loop — same "write it once" rationale as matchesAnyFilterValue itself.
export function matchesAllColumnFilters<T>(
  row: T,
  filters: Record<string, string[]>,
  getCellValue: (row: T, key: string) => string | number | null | undefined,
): boolean {
  for (const key of Object.keys(filters)) {
    const values = filters[key];
    if (!values || !values.length) continue;
    if (!matchesAnyFilterValue(getCellValue(row, key), values)) return false;
  }
  return true;
}
