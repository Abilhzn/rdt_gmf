import { Pipe, PipeTransform } from '@angular/core';

// Ground truth ui-demo.html formats every timestamp with `new Date(x).toLocaleString('id-ID')`
// (e.g. "24/7/2026, 10.21.02") — Angular's DatePipe 'medium' format doesn't reproduce that exact
// shape even with the id-ID locale registered (different date/time punctuation), so this calls
// the same native API directly instead of fighting Angular's i18n locale-data system for a
// cosmetic match.
@Pipe({ name: 'idDate', standalone: false })
export class IdDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';
    return new Date(value).toLocaleString('id-ID');
  }
}
