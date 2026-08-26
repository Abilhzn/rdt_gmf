import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import databaseConfig from './database.config';

/**
 * Bungkus satu `pg.Pool` (raw parameterized SQL, bukan ORM — lihat RENCANA_REWRITE_NESTJS.md §5).
 * Semua module inject service ini via DI, tidak pernah `new Pool()` sendiri.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>,
  ) {
    this.pool = new Pool(config);
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) {
    return this.pool.query<T>(text, params);
  }

  /**
   * Unit-of-work: BEGIN → jalankan fn(client) → COMMIT. ROLLBACK otomatis kalau fn throw,
   * lalu re-throw (jadi domain error dari service yang dipanggil tetap naik ke exception
   * filter, tapi rollback sudah kelar duluan — guardrail Batch 3).
   *
   * Row-lock pesimistik: panggil `SELECT ... FOR UPDATE` di dalam `fn` pakai `client` yang
   * diberikan (bukan `this.query`), supaya tetap di transaksi/koneksi yang sama.
   *
   *   await db.withTransaction(async (client) => {
   *     const { rows } = await client.query('SELECT * FROM t WHERE id = $1 FOR UPDATE', [id]);
   *     await client.query('UPDATE t SET status = $1 WHERE id = $2', ['DONE', id]);
   *   });
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
