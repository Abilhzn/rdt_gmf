import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

/**
 * `rdt.dinas_mapping` — read-only, dipakai `RoutingConfigService` buat resolve upload. Editor
 * (dulu PUT lewat halaman Admin TAB) dihapus — template input sudah di-fix TAB penanggung jawab
 * repost, gak perlu lagi koreksi ad-hoc; ubah tabelnya langsung kalau memang perlu.
 */
@Injectable()
export class MappingService {
  constructor(private readonly db: DatabaseService) {}

  async getAll(): Promise<Record<string, string>> {
    const { rows } = await this.db.query<{
      prefix: string;
      dinas_code: string;
    }>('SELECT prefix, dinas_code FROM rdt.dinas_mapping');
    const mapping: Record<string, string> = {};
    rows.forEach((row) => {
      mapping[row.prefix] = row.dinas_code;
    });
    return mapping;
  }
}
