import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';

/**
 * `rdt.dinas_mapping` — port dari `index.js` GET/PUT `/api/mapping`.
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

  /**
   * Merge/upsert — key yang tak disebut di `entries` TIDAK dihapus (beda dari
   * `ExclusionService.replaceAll`, lihat komentar di sana).
   */
  async upsertMany(
    entries: Record<string, string>,
    updatedByUserId: string | null,
  ): Promise<void> {
    const pairs = Object.entries(entries);
    for (const [, dinasCode] of pairs) {
      if (typeof dinasCode !== 'string' || !dinasCode) {
        throw new DomainError(
          'Body mapping harus { "<prefix>": "<dinas_code>", ... }',
          400,
          'INVALID_MAPPING_BODY',
        );
      }
    }
    await this.db.withTransaction(async (client) => {
      for (const [prefix, dinasCode] of pairs) {
        await client.query(
          `INSERT INTO rdt.dinas_mapping (prefix, dinas_code, updated_by_user_id, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (prefix) DO UPDATE
             SET dinas_code = EXCLUDED.dinas_code,
                 updated_by_user_id = EXCLUDED.updated_by_user_id,
                 updated_at = now()`,
          [prefix, dinasCode, updatedByUserId],
        );
      }
    });
  }
}
