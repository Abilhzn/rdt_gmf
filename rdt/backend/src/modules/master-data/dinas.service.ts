import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

export interface Dinas {
  code: string;
  name: string;
}

@Injectable()
export class DinasService {
  constructor(private readonly db: DatabaseService) {}

  /** Untuk picker/reassign — dinas nonaktif disembunyikan (index.js `GET /api/dinas`). */
  async listActive(): Promise<Dinas[]> {
    const { rows } = await this.db.query<Dinas>(
      'SELECT code, name FROM rdt.dinas WHERE is_active = true ORDER BY code',
    );
    return rows;
  }

  /**
   * Untuk parser routing (`RoutingConfigService`) — SEMUA kode, TANPA filter is_active.
   * Recipient yang match dinas nonaktif-tapi-nyata tetap harus RESOLVE, bukan NEEDS_REVIEW.
   * Jangan tambahin `WHERE is_active` di sini (lihat catatan Batch 2).
   */
  async listAllCodes(): Promise<string[]> {
    const { rows } = await this.db.query<{ code: string }>(
      'SELECT code FROM rdt.dinas',
    );
    return rows.map((r) => r.code);
  }
}
