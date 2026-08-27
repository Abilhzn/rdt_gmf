import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

/**
 * `rdt.exclusion_rules` — read-only, dipakai `RoutingConfigService` buat resolve upload. Editor
 * (dulu PUT lewat halaman Admin TAB) dihapus — sama alasan dengan `MappingService`.
 */
@Injectable()
export class ExclusionService {
  constructor(private readonly db: DatabaseService) {}

  async getAll(): Promise<string[]> {
    const { rows } = await this.db.query<{ prefix: string }>(
      'SELECT prefix FROM rdt.exclusion_rules ORDER BY prefix',
    );
    return rows.map((r) => r.prefix);
  }
}
