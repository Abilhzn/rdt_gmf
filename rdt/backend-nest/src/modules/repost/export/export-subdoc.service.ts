import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { RollbackAuditService } from '../shared/rollback-audit.service';

export interface AddSubdocResult {
  id: number;
  subdoc_number: string;
  created_at: Date | string;
  transaction_ids: number[];
}

interface BatchRow {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
}

/**
 * `POST repost/export/:batchId/subdocs` — port `POST /:batchId/subdocs` (Batch 4c, kasus
 * **overflow**): satu pasangan CONFIRMED >300 baris tak muat di satu subdoc (cap SAP) — rute ini
 * nambah subdoc kedua dst ke batch yang SUDAH ADA (batch+subdoc pertama lahir atomik di
 * `POST confirm`, 4b). Transaksi SENDIRI (terpisah dari 4b).
 */
@Injectable()
export class ExportSubdocService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rollbackAudit: RollbackAuditService,
  ) {}

  async addSubdoc(args: {
    batchId: number;
    rawSubdocNumber: unknown;
    rawTransactionIds: unknown;
    userId: string;
    ip: string | null;
  }): Promise<AddSubdocResult> {
    // Pra-transaksi: subdoc_number wajib non-kosong setelah trim. Port apa adanya; selalu
    // string di praktiknya (dari DTO @IsString()).
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const subdocNumber = String(args.rawSubdocNumber ?? '').trim();
    if (!subdocNumber) {
      throw new DomainError(
        'subdoc_number is required',
        400,
        'SUBDOC_NUMBER_REQUIRED',
      );
    }
    const requestedIds = Array.isArray(args.rawTransactionIds)
      ? args.rawTransactionIds.map(Number)
      : null;

    try {
      return await this.db.withTransaction((client) =>
        this.runAddSubdoc(client, {
          batchId: args.batchId,
          subdocNumber,
          requestedIds,
          userId: args.userId,
          ip: args.ip,
        }),
      );
    } catch (err) {
      throw await this.wrapRollback(err, args.userId, args.ip);
    }
  }

  private async runAddSubdoc(
    client: PoolClient,
    params: {
      batchId: number;
      subdocNumber: string;
      requestedIds: number[] | null;
      userId: string;
      ip: string | null;
    },
  ): Promise<AddSubdocResult> {
    const { batchId, subdocNumber, requestedIds, userId, ip } = params;

    const batchRes = await client.query<BatchRow>(
      'SELECT id, dinas_inisiasi, dinas_target FROM rdt.export_batches WHERE id=$1',
      [batchId],
    );
    if (!batchRes.rows.length) {
      throw new DomainError(
        `batch not found: ${batchId}`,
        404,
        'EXPORT_BATCH_NOT_FOUND',
      );
    }
    const batch = batchRes.rows[0];

    const unassignedRes = await client.query<{ id: number }>(
      'SELECT id FROM rdt.transactions WHERE export_batch_id=$1 AND subdoc_id IS NULL',
      [batchId],
    );
    const unassignedIds = new Set(unassignedRes.rows.map((r) => Number(r.id)));

    let targetIds: number[];
    if (requestedIds) {
      const invalid = requestedIds.filter((id) => !unassignedIds.has(id));
      if (invalid.length) {
        throw new DomainError(
          `transaction_ids not eligible (not in this batch, or already covered by another subdoc): ${invalid.join(', ')}`,
          400,
          'INVALID_SUBDOC_TRANSACTION_IDS',
        );
      }
      targetIds = requestedIds;
    } else {
      targetIds = Array.from(unassignedIds);
    }
    if (!targetIds.length) {
      throw new DomainError(
        'no unassigned transactions to cover — every line in this batch already has a subdoc',
        400,
        'NO_UNASSIGNED_TRANSACTIONS',
      );
    }

    const insertRes = await client.query<{
      id: number;
      subdoc_number: string;
      created_at: Date | string;
    }>(
      'INSERT INTO rdt.export_subdocs (batch_id, subdoc_number) VALUES ($1, $2) RETURNING id, subdoc_number, created_at',
      [batchId, subdocNumber],
    );
    const subdocId = Number(insertRes.rows[0].id);
    await client.query(
      'UPDATE rdt.transactions SET subdoc_id=$1 WHERE id = ANY($2)',
      [subdocId, targetIds],
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [
        userId,
        'SUBDOC_ADDED',
        'CONFIRMED',
        'CONFIRMED',
        JSON.stringify({
          batch_id: batchId,
          dinas_inisiasi: batch.dinas_inisiasi,
          dinas_target: batch.dinas_target,
          subdoc_number: subdocNumber,
          transaction_ids: targetIds,
        }),
        ip,
      ],
    );

    return {
      id: subdocId,
      subdoc_number: insertRes.rows[0].subdoc_number,
      created_at: insertRes.rows[0].created_at,
      transaction_ids: targetIds,
    };
  }

  // Pola sama seperti PersistService/ExportConfirmService.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'repost/export/:batchId/subdocs',
    });
    if (err instanceof DomainError) {
      return new DomainError(
        err.message,
        err.statusCode,
        err.errorCode,
        category,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(message, 500, 'EXPORT_SUBDOC_FAILED', category);
  }
}
