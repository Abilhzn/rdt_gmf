import { Pipe, PipeTransform } from '@angular/core';

// `new Date(x).toLocaleString('id-ID')` (e.g. "24/7/2026, 10.21.02") — Angular's DatePipe 'medium'
// format doesn't reproduce that exact shape even with id-ID registered, so this calls the native
// API directly instead of fighting Angular's i18n locale-data system.
@Pipe({ name: 'idDate', standalone: false })
export class IdDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';
    return new Date(value).toLocaleString('id-ID');
  }
}
