import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import databaseConfig from './database.config';

// node-pg returns bigint/bigserial columns (OID 20) as JS strings by default, to avoid silent
// precision loss above Number.MAX_SAFE_INTEGER. Every PK/FK in this schema is `bigserial`
// (schema.sql) and callers everywhere (DTOs' `@IsInt()`, frontend TS `id: number` types) assume a
// real number — round-tripping an id (e.g. confirmation queue row -> submit payload) sent it back
// as a JSON string and failed backend validation. Parse globally here, once, instead of coercing
// at every call site.
// ponytail: parseInt loses precision past 2^53 (~9 quadrillion rows) — a non-issue for this
// schema's transaction volume; switch to string ids everywhere (DTOs + frontend) if that ever
// changes.
types.setTypeParser(20, (val) => parseInt(val, 10));

/**
 * Bungkus satu `pg.Pool` (raw parameterized SQL, bukan ORM — lihat RENCANA_REWRITE_NESTJS.md §5).
 * Semua module inject service ini via DI, tidak pernah `new Pool()` sendiri.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

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
    let txnError: unknown;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      txnError = err;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // ROLLBACK itu sendiri gagal (koneksi kemungkinan sudah mati) -- jangan biarkan ini
        // menutupi txnError asli, yang tetap di-throw di bawah. client.release(txnError) di
        // finally akan membuang koneksi ini dari pool alih-alih mendaur ulangnya.
        this.logger.error(
          `ROLLBACK gagal setelah error transaksi (koneksi kemungkinan rusak): ${String(rollbackErr)}`,
        );
      }
      throw txnError;
    } finally {
      client.release(txnError as Error | undefined);
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
