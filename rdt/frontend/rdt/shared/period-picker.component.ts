import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

// REQ-RDT-UI-07 (4 Agu): the periode DT field (REQ-RDT-SAP-13) used a bare native
// <input type="month"> — browser-rendered as a long scrollable month/year list, which the
// project owner asked to replace with Prev/Next-by-year navigation: one year's 12 months shown
// at once, arrows to change year. Value stays a plain "YYYY-MM" string (same contract the native
// input had) so callers don't need to change how they read/validate `period` elsewhere.
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

@Component({
  selector: 'rdt-period-picker',
  standalone: false,
  templateUrl: './period-picker.component.html',
  styleUrls: ['./period-picker.component.scss'],
})
export class PeriodPickerComponent {
  @Input() value: string | null = null;
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  readonly monthLabels = MONTH_LABELS;
  panelYear = new Date().getFullYear();

  constructor(private host: ElementRef<HTMLElement>) {}

  get selectedYear(): number | null {
    if (!this.value) return null;
    const y = Number(this.value.slice(0, 4));
    return Number.isFinite(y) ? y : null;
  }

  get selectedMonth(): number | null {
    if (!this.value) return null;
    const m = Number(this.value.slice(5, 7));
    return Number.isFinite(m) ? m : null;
  }

  get displayLabel(): string {
    if (!this.value || this.selectedYear === null || this.selectedMonth === null) return 'Pilih periode';
    return `${this.monthLabels[this.selectedMonth - 1]} ${this.selectedYear}`;
  }

  toggle(): void {
    if (!this.open) this.panelYear = this.selectedYear ?? new Date().getFullYear();
    this.open = !this.open;
  }

  prevYear(): void { this.panelYear -= 1; }
  nextYear(): void { this.panelYear += 1; }

  isSelected(monthIndex1: number): boolean {
    return this.selectedYear === this.panelYear && this.selectedMonth === monthIndex1;
  }

  pickMonth(monthIndex1: number): void {
    const mm = String(monthIndex1).padStart(2, '0');
    this.value = `${this.panelYear}-${mm}`;
    this.valueChange.emit(this.value);
    this.open = false;
  }

  // Click-outside-to-close, same pattern as ShellComponent's user-menu dropdown.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }
}
