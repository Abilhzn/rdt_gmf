import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../core/database/database.service';
import { DIRECTORY_PROVIDER } from '../../../core/directory/directory.interface';
import type { DirectoryProvider } from '../../../core/directory/directory.interface';
import { DomainError } from '../../../core/errors/domain-error';
import { validateFreeText } from '../../../core/utils/text-validation';
import {
  filterMentionsToPair,
  resolveMentionedUserIds,
} from '../rules/mention-rules';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ATTACHABLE_STATUSES, BLOCKING_STATUSES } from './export.service';

export interface ConfirmExportResult {
  batch_id: number;
  attached_count: number;
  notified_user_ids: string[];
  subdoc_number: string;
}

interface AttachedRow {
  id: number;
}

/**
 * `POST repost/export/confirm` — port `POST /api/export-batches/confirm` (Batch 4b). 🔴 Zona
 * transaksi finansial: satu batch = kumpulan transaksi yang resmi "sudah direpost ke SAP". Satu
 * transaksi DB atomik: gate defensif -> INSERT batch -> attach baris ATTACHABLE -> subdoc pertama
 * -> comment top-level baru + notifikasi -> 2 audit_log.
 *
 * ⚠️ Closing_description SENGAJA tidak lewat `PairCommentService` (3c) -- kode lama SELALU bikin
 * comment top-level baru (`parent_comment_id: NULL`), tak pernah reply thread lama. Reuse
 * `PairCommentService.post()` di sini akan diam-diam mengubah behavior itu, jadi logic
 * resolusi-penerima di-port sendiri di bawah.
 */
@Injectable()
export class ExportConfirmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rollbackAudit: RollbackAuditService,
    @Inject(DIRECTORY_PROVIDER) private readonly directory: DirectoryProvider,
  ) {}

  async confirm(args: {
    rawDinasInisiasi: unknown;
    rawDinasTarget: unknown;
    rawClosingDescription: unknown;
    rawSubdocNumber: unknown;
    rawTransactionIds: unknown;
    userId: string;
    ip: string | null;
  }): Promise<ConfirmExportResult> {
    // Pra-transaksi: 400 di sini, JANGAN buka transaksi kalau salah satu gagal.
    const dinasInisiasi = this.requireNonEmptyString(
      args.rawDinasInisiasi,
      'dinas_inisiasi',
    );
    const dinasTarget = this.requireNonEmptyString(
      args.rawDinasTarget,
      'dinas_target',
    );
    const closingDescriptionCheck = validateFreeText(
      args.rawClosingDescription,
      { fieldLabel: 'closing_description' },
    );
    if (!closingDescriptionCheck.ok) {
      throw new DomainError(
        closingDescriptionCheck.error,
        400,
        closingDescriptionCheck.code,
      );
    }
    const closingDescription = closingDescriptionCheck.value;
    // port apa adanya; subdoc_number selalu string di praktiknya (dari DTO @IsString()).
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
        this.runConfirm(client, {
          dinasInisiasi,
          dinasTarget,
          closingDescription,
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

  private requireNonEmptyString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new DomainError(`${field} is required`, 400, 'FIELD_REQUIRED');
    }
    return raw;
  }

  private async runConfirm(
    client: PoolClient,
    params: {
      dinasInisiasi: string;
      dinasTarget: string;
      closingDescription: string | null;
      subdocNumber: string;
      requestedIds: number[] | null;
      userId: string;
      ip: string | null;
    },
  ): Promise<ConfirmExportResult> {
    const {
      dinasInisiasi,
      dinasTarget,
      closingDescription,
      subdocNumber,
      requestedIds,
      userId,
      ip,
    } = params;

    // 1. Gate defensif (re-check server-side): nol baris BLOCKING tersisa buat pasangan ini.
    const gate = await client.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi = ANY($3)`,
      [dinasInisiasi, dinasTarget, BLOCKING_STATUSES],
    );
    if (gate.rows[0].cnt > 0) {
      throw new DomainError(
        `${gate.rows[0].cnt} transaksi ${dinasInisiasi}→${dinasTarget} masih PENDING/DECLINED/NEEDS_REVIEW — belum bisa confirm`,
        400,
        'PAIR_NOT_READY',
      );
    }

    // 2. INSERT export_batches.
    const batchRes = await client.query<{ id: number }>(
      `INSERT INTO rdt.export_batches(dinas_inisiasi, dinas_target, closing_description, confirmed_by_user_id, confirmed_at)
       VALUES ($1,$2,$3,$4,now()) RETURNING id`,
      [dinasInisiasi, dinasTarget, closingDescription, userId],
    );
    const batchId = Number(batchRes.rows[0].id);

    // 3. Attach setiap baris ATTACHABLE pasangan ini ke batch.
    const attachRes = await client.query<AttachedRow>(
      `UPDATE rdt.transactions SET export_batch_id=$1
       WHERE dinas_inisiasi=$2 AND dinas_target=$3 AND status_konfirmasi = ANY($4) AND export_batch_id IS NULL
       RETURNING id`,
      [batchId, dinasInisiasi, dinasTarget, ATTACHABLE_STATUSES],
    );
    if (!attachRes.rowCount) {
      throw new DomainError(
        `Tidak ada transaksi CONFIRMED/BORNE_BY_INITIATOR untuk ${dinasInisiasi}→${dinasTarget} — tidak ada yang bisa di-confirm`,
        400,
        'NO_ATTACHABLE_ROWS',
      );
    }

    // 4. Subdoc pertama, SAMA transaksi -- default semua baris yang baru di-attach; kalau
    // transaction_ids diberi, harus subset dari situ.
    const attachedIds = new Set(attachRes.rows.map((r) => Number(r.id)));
    let subdocTargetIds: number[];
    if (requestedIds) {
      const invalid = requestedIds.filter((id) => !attachedIds.has(id));
      if (invalid.length) {
        throw new DomainError(
          `transaction_ids not eligible (not attached to this pair just now): ${invalid.join(', ')}`,
          400,
          'INVALID_SUBDOC_TRANSACTION_IDS',
        );
      }
      subdocTargetIds = requestedIds;
    } else {
      subdocTargetIds = Array.from(attachedIds);
    }
    const subdocRes = await client.query<{ id: number }>(
      'INSERT INTO rdt.export_subdocs (batch_id, subdoc_number) VALUES ($1, $2) RETURNING id',
      [batchId, subdocNumber],
    );
    const subdocId = Number(subdocRes.rows[0].id);
    await client.query(
      'UPDATE rdt.transactions SET subdoc_id=$1 WHERE id = ANY($2)',
      [subdocId, subdocTargetIds],
    );

    // 5. Comment top-level BARU (bukan reply -- lihat header comment kelas ini) + notifikasi.
    const commentBody =
      closingDescription ||
      `Repost ${dinasInisiasi} → ${dinasTarget} dikonfirmasi oleh TAB (subdoc ${subdocNumber}).`;
    const anchorId = attachRes.rows.reduce(
      (max, row) => Math.max(max, Number(row.id)),
      0,
    );
    const commentRes = await client.query<{ id: number }>(
      `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body)
       VALUES ($1, NULL, $2, $3) RETURNING id`,
      [anchorId, userId, commentBody],
    );
    const commentId = Number(commentRes.rows[0].id);

    const directory = await this.directory.load();
    const mentioned = filterMentionsToPair(
      resolveMentionedUserIds(commentBody, directory),
      directory,
      [dinasInisiasi, dinasTarget],
    );
    const recipientIds = new Set(mentioned);
    Object.keys(directory).forEach((id) => {
      if (
        String(directory[id].dinas).toUpperCase() === dinasTarget.toUpperCase()
      ) {
        recipientIds.add(id);
      }
    });
    recipientIds.delete(userId);
    const notifiedUserIds: string[] = [];
    for (const recipientId of recipientIds) {
      await client.query(
        'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
        [recipientId, commentId],
      );
      notifiedUserIds.push(recipientId);
    }

    // 6. 2 audit_log.
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [
        userId,
        'EXPORT_BATCH_CONFIRM',
        'WAITING',
        'CONFIRMED',
        JSON.stringify({
          batch_id: batchId,
          dinas_inisiasi: dinasInisiasi,
          dinas_target: dinasTarget,
          closing_description: closingDescription,
          attached_count: attachRes.rowCount,
          notified_user_ids: notifiedUserIds,
        }),
        ip,
      ],
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
          dinas_inisiasi: dinasInisiasi,
          dinas_target: dinasTarget,
          subdoc_number: subdocNumber,
          transaction_ids: subdocTargetIds,
        }),
        ip,
      ],
    );

    return {
      batch_id: batchId,
      attached_count: attachRes.rowCount,
      notified_user_ids: notifiedUserIds,
      subdoc_number: subdocNumber,
    };
  }

  // withTransaction sudah ROLLBACK sebelum re-throw. Audit rollback ditulis lewat
  // RollbackAuditService (koneksi terpisah, 3c) -- statusCode/errorCode asli dipertahankan kalau
  // err sudah DomainError, fallback 500 untuk yang lain. Pola sama seperti
  // ReassignmentService/PersistService.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'repost/export/confirm',
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
    return new DomainError(message, 500, 'EXPORT_CONFIRM_FAILED', category);
  }
}
