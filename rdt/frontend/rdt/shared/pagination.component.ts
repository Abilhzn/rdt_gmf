import { Component, EventEmitter, Input, Output } from '@angular/core';

// Shared "Google-style" pager — at most 5 page numbers shown at once as a sliding window centered
// on the current page, with a leading/trailing "…" (non-clickable, just an indicator) when the
// window doesn't reach page 1 / the last page.
@Component({
  selector: 'rdt-pagination',
  standalone: false,
  templateUrl: './pagination.component.html',
  styleUrls: ['./pagination.component.scss'],
})
export class PaginationComponent {
  @Input() page = 1;
  @Input() totalItems = 0;
  // Every caller sets pageSize=50 explicitly too; the default here is just a fallback.
  @Input() pageSize = 50;
  @Output() pageChange = new EventEmitter<number>();

  private readonly maxVisible = 5;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get visiblePages(): number[] {
    const total = this.totalPages;
    if (total <= this.maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
    const half = Math.floor(this.maxVisible / 2);
    let start = this.page - half;
    let end = this.page + half;
    if (start < 1) { start = 1; end = this.maxVisible; }
    if (end > total) { end = total; start = total - this.maxVisible + 1; }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get showLeadingEllipsis(): boolean {
    return this.visiblePages[0] > 1;
  }

  get showTrailingEllipsis(): boolean {
    return this.visiblePages[this.visiblePages.length - 1] < this.totalPages;
  }

  goTo(p: number): void {
    const clamped = Math.min(Math.max(1, p), this.totalPages);
    if (clamped !== this.page) this.pageChange.emit(clamped);
  }

  prev(): void { this.goTo(this.page - 1); }
  next(): void { this.goTo(this.page + 1); }
}
