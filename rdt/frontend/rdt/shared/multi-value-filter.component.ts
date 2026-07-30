import { Component, EventEmitter, Input, Output } from '@angular/core';

// REQ-RDT-NAV-09 (31 Jul, "filter multi-value ala SAP"): a paste box for filtering a table
// column against MANY values at once (e.g. pasting a column of Account numbers copied out of
// Excel) — every row whose value matches ANY of the pasted values (OR, not AND) stays visible.
// One reusable component for every transaction-data table (Repost Review, Confirmation,
// Dashboard-Detailing, Need Approval transparency, Riwayat Repost TAB/Dinas, Investigation),
// same "write it once, reuse everywhere" rationale as PaginationComponent (REQ-RDT-NAV-07) — see
// that component's header comment for why: this used to get reimplemented per-page.
//
// This component only owns the paste box UI + parsing; each page keeps its own filtering
// (different columns, different row shapes) using matchesAnyFilterValue below against the
// values this emits.
@Component({
  selector: 'rdt-multi-value-filter',
  standalone: false,
  templateUrl: './multi-value-filter.component.html',
  styleUrls: ['./multi-value-filter.component.scss'],
})
export class MultiValueFilterComponent {
  @Input() placeholder = 'Tempel nilai di sini (satu per baris atau pisah koma)...';
  @Output() valuesChange = new EventEmitter<string[]>();

  raw = '';
  values: string[] = [];

  onInput(): void {
    this.values = parseMultiValueFilter(this.raw);
    this.valuesChange.emit(this.values);
  }

  clear(): void {
    this.raw = '';
    this.values = [];
    this.valuesChange.emit(this.values);
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
