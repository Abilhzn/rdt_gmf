import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

/**
 * `rdt.exclusion_rules` — port dari `index.js` GET/PUT `/api/exclusions`.
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

  /**
   * Replace-all — DELETE semua lalu re-insert `prefixes`. Beda semantik dari
   * `MappingService.upsertMany` (merge): di sini prefix yang tak disebut memang HILANG,
   * itu perilaku lama (`index.js`), bukan bug.
   */
  async replaceAll(
    prefixes: string[],
    updatedByUserId: string | null,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query('DELETE FROM rdt.exclusion_rules');
      for (const prefix of prefixes) {
        await client.query(
          `INSERT INTO rdt.exclusion_rules (prefix, updated_by_user_id, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (prefix) DO NOTHING`,
          [prefix, updatedByUserId],
        );
      }
    });
  }
}
