import { Component, Input } from '@angular/core';
import { AggregationMatrix, Transaction } from '../../../shared/models/transaction.model';

/** Dumb: renders the category × dinas pivot, deliberately shaped like the pivot sheet in the
 * source Excel file so a PIC can eyeball-match numbers directly. Computed client-side from `rows`
 * — `POST repost/upload/parse`'s response only returns a flat status/dinas recap, not a category
 * breakdown, so there's no server-provided matrix to consume. */
@Component({
  selector: 'rdt-aggregation-matrix',
  standalone: false,
  template: `
    <div class="table-scroll">
      <table class="matrix">
        <thead>
          <tr>
            <th class="matrix__rowhead">Kategori</th>
            <th *ngFor="let d of dinasList">{{ d }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let cat of categories">
            <th class="matrix__rowhead">{{ cat }}</th>
            <td *ngFor="let d of dinasList" class="matrix__num">
              {{ value(cat, d) !== null ? (value(cat, d) | number: '1.2-2') : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class AggregationMatrixComponent {
  @Input() rows: Transaction[] = [];

  get matrix(): AggregationMatrix {
    const m: AggregationMatrix = {};
    for (const r of this.rows) {
      const cat = String(r.category ?? '—');
      const dinas = r.dinas_target ?? '—';
      const nominal = typeof r.nominal === 'number' ? r.nominal : 0;
      m[cat] = m[cat] || {};
      m[cat][dinas] = Math.round(((m[cat][dinas] || 0) + nominal) * 100) / 100;
    }
    return m;
  }

  get categories(): string[] {
    return Object.keys(this.matrix).sort();
  }

  get dinasList(): string[] {
    const set = new Set<string>();
    Object.values(this.matrix).forEach((byDinas) => Object.keys(byDinas).forEach((d) => set.add(d)));
    return Array.from(set).sort();
  }

  value(category: string, dinas: string): number | null {
    const v = this.matrix?.[category]?.[dinas];
    return typeof v === 'number' ? v : null;
  }
}
