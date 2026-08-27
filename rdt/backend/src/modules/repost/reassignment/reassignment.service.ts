import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import type { Identity } from '../../../core/security/identity.interface';
import { validateFreeText } from '../../../core/utils/text-validation';
import {
  buildValidCodeMap,
  validateReassignTarget,
} from '../rules/reassignment-rules';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { BatchResolveItemDto } from './dto/resolve-declined.dto';

export interface DeclinedRow {
  id: number;
  sheet_name: string | null;
  raw_row_index: number | null;
  account: unknown;
  nominal: string;
  category: unknown;
  remark: unknown;
  ref_doc: unknown;
  dinas_target: string | null;
  reassign_count: number;
}

interface LockedDeclinedRow {
  id: number;
  status_konfirmasi: string;
  dinas_target: string;
  dinas_inisiasi: string;
  reassign_count: number;
}

/**
 * `repost/reassignment` — port `routes/reassignment.js`: resolusi DECLINED oleh inisiator
 * (BORNE_BY_INITIATOR atau REASSIGN ke dinas lain). Pola sama dengan `ConfirmationService` (3b):
 * `db.withTransaction` + `FOR UPDATE` + rollback-audit via `RollbackAuditService` (3c, dipakai
 * bersama, bukan ditulis ulang).
 */
@Injectable()
export class ReassignmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rollbackAudit: RollbackAuditService,
  ) {}

  // GET /repost/reassignment/:dinas — baris DECLINED yang diajukan dinas ini, menunggu resolusi.
  async listDeclined(dinas: string): Promise<DeclinedRow[]> {
    const { rows } = await this.db.query<DeclinedRow>(
      `SELECT id, sheet_name, raw_row_index, account, nominal, category, remark, ref_doc, dinas_target, reassign_count
       FROM rdt.transactions WHERE dinas_inisiasi=$1 AND status_konfirmasi='DECLINED'`,
      [dinas],
    );
    return rows;
  }

  // POST /repost/reassignment/:id/resolve — satu baris, transaksi tunggal.
  async resolveOne(
    user: Identity,
    args: {
      id: number;
      action: unknown;
      newTarget: unknown;
      rawNote: unknown;
      ip: string | null;
    },
  ): Promise<void> {
    try {
      await this.db.withTransaction((client) =>
        this.resolveOneDeclined(client, user, args),
      );
    } catch (err) {
      throw await this.wrapRollback(err, {
        userId: user.userId,
        ip: args.ip,
        route: `repost/reassignment/${args.id}/resolve`,
        transactionId: args.id,
        fallbackErrorCode: 'REASSIGNMENT_RESOLVE_FAILED',
      });
    }
  }

  // POST /repost/reassignment/batch-resolve — SATU transaksi, all-or-nothing (item 10 lama).
  async batchResolve(
    user: Identity,
    items: BatchResolveItemDto[],
    rawNote: unknown,
    ip: string | null,
  ): Promise<{ resolved_count: number }> {
    try {
      await this.db.withTransaction(async (client) => {
        for (const item of items) {
          await this.resolveOneDeclined(client, user, {
            id: item.id,
            action: item.action,
            newTarget: item.new_dinas_target,
            rawNote,
            ip,
          });
        }
      });
      return { resolved_count: items.length };
    } catch (err) {
      throw await this.wrapRollback(err, {
        userId: user.userId,
        ip,
        route: 'repost/reassignment/batch-resolve',
        fallbackErrorCode: 'REASSIGNMENT_BATCH_RESOLVE_FAILED',
      });
    }
  }

  // Logika per-baris (dipakai resolveOne DAN batchResolve, di dalam transaksi yang sama) — port
  // `resolveOneDeclined` lama. Throw DomainError langsung (400/403/404/409) supaya httpStatus-nya
  // ikut terbawa sampai ke wrapRollback di atas.
  private async resolveOneDeclined(
    client: PoolClient,
    user: Identity,
    args: {
      id: number;
      action: unknown;
      newTarget: unknown;
      rawNote: unknown;
      ip: string | null;
    },
  ): Promise<void> {
    const { id, action, newTarget, rawNote, ip } = args;
    if (action !== 'BORNE' && action !== 'REASSIGN') {
      throw new DomainError(
        "action must be 'BORNE' or 'REASSIGN'",
        400,
        'INVALID_ACTION',
      );
    }
    const noteCheck = validateFreeText(rawNote, { fieldLabel: 'Catatan' });
    if (!noteCheck.ok)
      throw new DomainError(noteCheck.error, 400, noteCheck.code);
    const note = noteCheck.value;

    const { rows } = await client.query<LockedDeclinedRow>(
      'SELECT id, status_konfirmasi, dinas_target, dinas_inisiasi, reassign_count FROM rdt.transactions WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!rows.length)
      throw new DomainError(
        `transaction not found: ${id}`,
        404,
        'TRANSACTION_NOT_FOUND',
      );
    const row = rows[0];

    // Otorisasi per-baris (bukan guard) — dinas_inisiasi baris cuma diketahui SETELAH lock.
    if (
      user.role !== 'TAB' &&
      String(user.dinas).toUpperCase() !==
        String(row.dinas_inisiasi).toUpperCase()
    ) {
      throw new DomainError(
        `only the initiator dinas (${row.dinas_inisiasi}) or TAB may resolve this transaction`,
        403,
        'FORBIDDEN_RESOLVE',
      );
    }
    if (row.status_konfirmasi !== 'DECLINED') {
      throw new DomainError(
        `transaction is not DECLINED: ${id}`,
        409,
        'NOT_DECLINED',
      );
    }

    if (action === 'BORNE') {
      // Pure status change: TANPA ledger (inisiator nanggung sendiri, tak ada budget lintas-dinas
      // yang berpindah) & TANPA snapshot periode_efektif (nilai dari DECLINE dipertahankan apa adanya).
      await client.query(
        `UPDATE rdt.transactions SET status_konfirmasi='BORNE_BY_INITIATOR', decided_by_user_id=$1, decided_at=now() WHERE id=$2`,
        [user.userId, id],
      );
      await client.query(
        `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'BORNE_BY_INITIATOR','DECLINED','BORNE_BY_INITIATOR',$3,$4)`,
        [
          user.userId,
          id,
          JSON.stringify({ dinas_inisiasi: row.dinas_inisiasi, note }),
          ip,
        ],
      );
      return;
    }

    // REASSIGN — target harus dinas aktif, cap REASSIGN_CAP (3a).
    const validRes = await client.query<{ code: string }>(
      'SELECT code FROM rdt.dinas WHERE is_active = true',
    );
    const validCodes = buildValidCodeMap(validRes.rows);
    const validation = validateReassignTarget({
      newTarget,
      validCodes,
      dinasInisiasi: row.dinas_inisiasi,
      currentDinasTarget: row.dinas_target,
      reassignCount: row.reassign_count,
    });
    if (!validation.ok) {
      throw new DomainError(
        validation.error,
        validation.httpStatus,
        'INVALID_REASSIGN_TARGET',
      );
    }
    const newTargetUpper = validation.newTargetUpper;

    // periode_efektif=NULL: DECLINE yang membawa baris ini ke sini sudah snapshot untuk pasangan
    // LAMA — baris ini mulai episode confirm/reject baru di pasangan BARU (newTargetUpper).
    await client.query(
      `UPDATE rdt.transactions
       SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from=$2, reassign_count=reassign_count+1,
           decided_by_user_id=NULL, decided_at=NULL, periode_efektif=NULL
       WHERE id=$3`,
      [newTargetUpper, row.dinas_target, id],
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'REASSIGN','DECLINED','PENDING',$3,$4)`,
      [
        user.userId,
        id,
        JSON.stringify({
          from_dinas: row.dinas_target,
          to_dinas: newTargetUpper,
          reassign_count: row.reassign_count + 1,
          note,
        }),
        ip,
      ],
    );
  }

  // withTransaction sudah ROLLBACK sebelum re-throw. Tulis audit ROLLBACK (koneksi terpisah, 3c)
  // lalu bungkus jadi DomainError — httpStatus/errorCode aslinya (400/403/404/409) dipertahankan
  // kalau err sudah DomainError (dilempar resolveOneDeclined), fallback 500 untuk yang lain.
  private async wrapRollback(
    err: unknown,
    args: {
      userId: string;
      ip: string | null;
      route: string;
      transactionId?: number;
      fallbackErrorCode: string;
    },
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId: args.userId,
      ip: args.ip,
      err,
      route: args.route,
      transactionId: args.transactionId ?? null,
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
    return new DomainError(message, 500, args.fallbackErrorCode, category);
  }
}
