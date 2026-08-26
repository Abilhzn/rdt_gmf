import { QueryResultRow } from 'pg';
import { DatabaseService } from './database.service';

/**
 * Base repository opsional untuk di-extend module lain. Tidak wajib dipakai — module boleh
 * inject `DatabaseService` langsung kalau query-nya tidak seragam per-tabel.
 */
export abstract class BaseRepository<T extends QueryResultRow> {
  protected constructor(
    protected readonly db: DatabaseService,
    protected readonly table: string,
  ) {}

  findById(id: number | string): Promise<T | undefined> {
    return this.db
      .query<T>(`SELECT * FROM ${this.table} WHERE id = $1`, [id])
      .then((res) => res.rows[0]);
  }
}
