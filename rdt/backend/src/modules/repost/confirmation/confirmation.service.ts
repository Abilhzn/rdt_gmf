import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DomainError } from '../../../core/errors/domain-error';
import { DatabaseService } from '../../../core/database/database.service';
import { validateFreeText } from '../../../core/utils/text-validation';
import {
  buildValidCodeMap,
  validateReassignTarget,
} from '../rules/reassignment-rules';
import {
  computeEffectivePeriod,
  pickDeadline,
} from '../rules/period-effective';
import { PairCommentService } from '../shared/pair-comment.service';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { SubmitDecisionDto } from './dto/submit-confirmation.dto';

// Baris antrian PENDING — t.* (53 kolom kontrak + kolom internal) plus upload_filename yang
// di-JOIN dari rdt.uploads, plus `chain` yang dihitung di getQueue. Longgar (index signature)
// karena controller/frontend meneruskan seluruh t.* apa adanya, sama seperti confirmation.js lama.
export interface QueueRow {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  reassign_count: number;
  upload_filename: string;
  chain?: string[];
  [column: string]: unknown;
}

interface LockedTransactionRow {
  id: number;
  status_konfirmasi: string;
  dinas_target: string;
  dinas_inisiasi: string;
  nominal: string;
  account: unknown;
  remark: unknown;
  ref_doc: unknown;
  reassign_count: number;
  period: string | null;
}

interface DecisionSummary {
  id: number;
  account: unknown;
  nominal: string;
  remark: unknown;
  ref_doc: unknown;
  dinas_inisiasi: string;
}

interface RedirectSummary extends DecisionSummary {
  redirected_to: string;
}

export interface SubmitResult {
  declined: DecisionSummary[];
  redirected: RedirectSummary[];
}

/**
 * `repost/confirmation` — port `routes/confirmation.js` (🔴 zona transaksi finansial). Modul
 * aturan dari Batch 3a (`reassignmentRules`, `periodEffective`, `mentionRules`,
 * `errorClassification`, `textValidation`) dikonsumsi di sini, tidak ditulis ulang.
 */
@Injectable()
export class ConfirmationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pairComment: PairCommentService,
    private readonly rollbackAudit: RollbackAuditService,
  ) {}

  // GET /repost/confirmation/:dinas — antrian PENDING + breadcrumb chain reassign.
  async getQueue(dinas: string): Promise<QueueRow[]> {
    const { rows } = await this.db.query<QueueRow>(
      `SELECT t.*, u.original_filename AS upload_filename
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.dinas_target = $1 AND t.status_konfirmasi = 'PENDING'`,
      [dinas],
    );

    const reassignedIds = rows
      .filter((t) => t.reassign_count > 0)
      .map((t) => t.id);
    const chainMap = new Map<number, string[]>();
    if (reassignedIds.length) {
      const { rows: auditRows } = await this.db.query<{
        transaction_id: number;
        detail: { from_dinas?: string } | null;
      }>(
        `SELECT transaction_id, detail FROM rdt.audit_log
         WHERE transaction_id = ANY($1) AND action IN ('REASSIGN', 'REJECT_REDIRECT')
         ORDER BY transaction_id, id ASC`,
        [reassignedIds],
      );
      for (const row of auditRows) {
        const fromDinas = row.detail?.from_dinas;
        if (!fromDinas) continue;
        const hops = chainMap.get(row.transaction_id) ?? [];
        if (!hops.includes(fromDinas)) hops.push(fromDinas);
        chainMap.set(row.transaction_id, hops);
      }
    }

    return rows.map((t) => ({
      ...t,
      chain: [t.dinas_inisiasi, ...(chainMap.get(t.id) ?? []), dinas],
    }));
  }

  // POST /repost/confirmation/:dinas/submit — batch CONFIRM/DECLINE/REJECT_REDIRECT, atomik.
  async submit(
    dinas: string,
    userId: string,
    decisions: SubmitDecisionDto[],
    rawDescription: unknown,
    ip: string | null,
  ): Promise<SubmitResult> {
    // Pra-transaksi: description tidak valid -> 400, jangan buka transaksi sama sekali.
    const descriptionCheck = validateFreeText(rawDescription, {
      fieldLabel: 'Deskripsi',
    });
    if (!descriptionCheck.ok) {
      throw new DomainError(descriptionCheck.error, 400, descriptionCheck.code);
    }
    const description = descriptionCheck.value;

    try {
      return await this.db.withTransaction((client) =>
        this.runSubmit(client, { dinas, userId, decisions, description, ip }),
      );
    } catch (err) {
      // withTransaction sudah ROLLBACK di dalam sebelum re-throw. Audit rollback ditulis lewat
      // RollbackAuditService (koneksi TERPISAH dari pool, autocommit, diekstrak di 3c) supaya
      // baris ini sendiri tidak ikut ter-rollback bersama transaksi utama yang barusan gagal.
      const category = await this.rollbackAudit.record({
        userId,
        ip,
        err,
        route: 'repost/confirmation/:dinas/submit',
      });
      const message = err instanceof Error ? err.message : String(err);
      throw new DomainError(
        message,
        500,
        'CONFIRMATION_SUBMIT_FAILED',
        category,
      );
    }
  }

  private async runSubmit(
    client: PoolClient,
    params: {
      dinas: string;
      userId: string;
      decisions: SubmitDecisionDto[];
      description: string | null;
      ip: string | null;
    },
  ): Promise<SubmitResult> {
    const { dinas, userId, decisions, description, ip } = params;
    const declined: DecisionSummary[] = [];
    const redirected: RedirectSummary[] = [];
    // Satu comment reply per dinas_inisiasi yang tersentuh batch ini — fallback transaction_id
    // kalau pasangan itu belum punya thread sama sekali.
    const initiatorTransactionId = new Map<string, number>();
    let validCodes: Map<string, string> | null = null;

    for (const d of decisions) {
      const row = await this.lockTransaction(client, d.id);
      if (row.status_konfirmasi !== 'PENDING')
        throw new Error(`transaction not pending: ${d.id}`);
      if (row.dinas_target !== dinas)
        throw new Error(`transaction target mismatch: ${d.id}`);
      if (!initiatorTransactionId.has(row.dinas_inisiasi)) {
        initiatorTransactionId.set(row.dinas_inisiasi, row.id);
      }

      if (d.claim === 'YA') {
        await this.confirm(client, { row, userId, dinas, ip });
      } else if (d.claim === 'TIDAK' && d.redirect_to) {
        if (!validCodes) validCodes = await this.loadValidCodes(client);
        redirected.push(
          await this.rejectRedirect(client, {
            row,
            userId,
            dinas,
            ip,
            redirectTo: d.redirect_to,
            validCodes,
          }),
        );
      } else if (d.claim === 'TIDAK') {
        declined.push(await this.decline(client, { row, userId, dinas, ip }));
      } else {
        throw new Error(`invalid claim value for id ${d.id}`);
      }
    }

    if (description) {
      await this.postDescriptionComments(client, {
        dinas,
        userId,
        description,
        initiatorTransactionId,
      });
    }

    return { declined, redirected };
  }

  private async lockTransaction(
    client: PoolClient,
    id: number,
  ): Promise<LockedTransactionRow> {
    // FOR UPDATE OF t: kunci baris transactions saja, bukan uploads yang di-JOIN.
    const { rows } = await client.query<LockedTransactionRow>(
      `SELECT t.id, t.status_konfirmasi, t.dinas_target, t.dinas_inisiasi, t.nominal, t.account,
              t.remark, t.ref_doc, t.reassign_count, u.period
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.id = $1 FOR UPDATE OF t`,
      [id],
    );
    if (!rows.length) throw new Error(`transaction not found: ${id}`);
    return rows[0];
  }

  private async confirm(
    client: PoolClient,
    args: {
      row: LockedTransactionRow;
      userId: string;
      dinas: string;
      ip: string | null;
    },
  ): Promise<void> {
    const { row, userId, dinas, ip } = args;
    await client.query(
      `UPDATE rdt.transactions SET status_konfirmasi='CONFIRMED', decided_by_user_id=$1, decided_at=now() WHERE id=$2`,
      [userId, row.id],
    );
    const amount = row.nominal;
    await client.query(
      `INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,'DEBIT',$3)`,
      [row.id, dinas, amount],
    );
    await client.query(
      `INSERT INTO rdt.ledger_entries(transaction_id,dinas_code,direction,amount) VALUES($1,$2,'CREDIT',$3)`,
      [row.id, row.dinas_inisiasi, amount],
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'CONFIRM','PENDING','CONFIRMED',$3,$4)`,
      [userId, row.id, JSON.stringify({ dinas, amount }), ip],
    );
    await this.snapshotPeriodeEfektif(client, {
      transactionId: row.id,
      dinasInisiasi: row.dinas_inisiasi,
      dinasTarget: dinas,
      declaredPeriod: row.period,
    });
  }

  private async decline(
    client: PoolClient,
    args: {
      row: LockedTransactionRow;
      userId: string;
      dinas: string;
      ip: string | null;
    },
  ): Promise<DecisionSummary> {
    const { row, userId, dinas, ip } = args;
    await client.query(
      `UPDATE rdt.transactions SET status_konfirmasi='DECLINED', decided_by_user_id=$1, decided_at=now() WHERE id=$2`,
      [userId, row.id],
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'DECLINE','PENDING','DECLINED',$3,$4)`,
      [userId, row.id, JSON.stringify({ dinas }), ip],
    );
    // DECLINE (tanpa redirect) IS aksi target Confirm/Reject — snapshot sekarang. Beda dari
    // REJECT_REDIRECT, yang belum "final" untuk pasangan ini (lihat rejectRedirect).
    await this.snapshotPeriodeEfektif(client, {
      transactionId: row.id,
      dinasInisiasi: row.dinas_inisiasi,
      dinasTarget: dinas,
      declaredPeriod: row.period,
    });
    return {
      id: row.id,
      account: row.account,
      nominal: row.nominal,
      remark: row.remark,
      ref_doc: row.ref_doc,
      dinas_inisiasi: row.dinas_inisiasi,
    };
  }

  private async loadValidCodes(
    client: PoolClient,
  ): Promise<Map<string, string>> {
    // is_active=true — target reassign cuma dinas aktif (tracker §6); lazy-load sekali per batch.
    const { rows } = await client.query<{ code: string }>(
      'SELECT code FROM rdt.dinas WHERE is_active = true',
    );
    return buildValidCodeMap(rows);
  }

  private async rejectRedirect(
    client: PoolClient,
    args: {
      row: LockedTransactionRow;
      userId: string;
      dinas: string;
      ip: string | null;
      redirectTo: string;
      validCodes: Map<string, string>;
    },
  ): Promise<RedirectSummary> {
    const { row, userId, dinas, ip, redirectTo, validCodes } = args;
    const validation = validateReassignTarget({
      newTarget: redirectTo,
      validCodes,
      dinasInisiasi: row.dinas_inisiasi,
      currentDinasTarget: row.dinas_target,
      reassignCount: row.reassign_count,
    });
    if (!validation.ok) throw new Error(`id ${row.id}: ${validation.error}`);
    const newTargetUpper = validation.newTargetUpper;

    // periode_efektif=NULL: baris mulai episode confirm/reject baru di pasangan lain — belum
    // "final" untuk pasangan ini, jadi TIDAK ada snapshot di sini (beda dari confirm/decline).
    await client.query(
      `UPDATE rdt.transactions
       SET dinas_target=$1, status_konfirmasi='PENDING', reassigned_from=$2, reassign_count=reassign_count+1,
           decided_by_user_id=NULL, decided_at=NULL, periode_efektif=NULL
       WHERE id=$3`,
      [newTargetUpper, row.dinas_target, row.id],
    );
    await client.query(
      `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'REJECT_REDIRECT','PENDING','PENDING',$3,$4)`,
      [
        userId,
        row.id,
        JSON.stringify({
          rejected_by: dinas,
          from_dinas: row.dinas_target,
          to_dinas: newTargetUpper,
          reassign_count: row.reassign_count + 1,
        }),
        ip,
      ],
    );
    return {
      id: row.id,
      account: row.account,
      nominal: row.nominal,
      remark: row.remark,
      ref_doc: row.ref_doc,
      dinas_inisiasi: row.dinas_inisiasi,
      redirected_to: newTargetUpper,
    };
  }

  // snapshotPeriodeEfektif — dikunci begitu dinas TARGET Confirm/Reject, dibandingkan ke deadline
  // yang berlaku SAAT ITU JUGA. Hanya dipanggil untuk CONFIRM & DECLINE (aksi final target),
  // bukan REJECT_REDIRECT (episode baru di pasangan lain) atau BORNE_BY_INITIATOR (di luar 3b).
  private async snapshotPeriodeEfektif(
    client: PoolClient,
    args: {
      transactionId: number;
      dinasInisiasi: string;
      dinasTarget: string;
      declaredPeriod: string | null;
    },
  ): Promise<void> {
    const { transactionId, dinasInisiasi, dinasTarget, declaredPeriod } = args;
    if (!declaredPeriod) return; // tidak ada periode dinyatakan -> tidak ada apa-apa buat dihitung

    const deadlineRes = await client.query<{ deadline_at: string | Date }>(
      'SELECT deadline_at FROM rdt.period_deadlines WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND periode=$3',
      [dinasInisiasi, dinasTarget, declaredPeriod],
    );
    const defaultRes = await client.query<{ deadline_at: string | Date }>(
      'SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode=$1',
      [declaredPeriod],
    );
    const deadlineAt = pickDeadline(deadlineRes.rows[0], defaultRes.rows[0]);
    const { periodeEfektif } = computeEffectivePeriod({
      declaredPeriod,
      deadlineAt,
      latestTargetActionAt: new Date(),
    });
    await client.query(
      'UPDATE rdt.transactions SET periode_efektif=$1 WHERE id=$2',
      [periodeEfektif, transactionId],
    );
  }

  // Description -> reply comment + notifikasi per dinas_inisiasi yang tersentuh batch ini.
  // Konteks (penerima implisit) = dinas_inisiasi, yang barusan dikonfirmasi/ditolak oleh
  // `dinas` — kebalikan dari investigation.js's postPairComment (3c), yang konteksnya
  // dinas_target BARU. Delegasi ke PairCommentService (3c) — logikanya sama, jangan duplikasi.
  private async postDescriptionComments(
    client: PoolClient,
    args: {
      dinas: string;
      userId: string;
      description: string;
      initiatorTransactionId: Map<string, number>;
    },
  ): Promise<void> {
    const { dinas, userId, description, initiatorTransactionId } = args;
    for (const [
      dinasInisiasi,
      fallbackTransactionId,
    ] of initiatorTransactionId) {
      await this.pairComment.post(client, {
        dinasInisiasi,
        dinasTarget: dinas,
        implicitRecipientDinas: dinasInisiasi,
        fallbackTransactionId,
        authorUserId: userId,
        body: description,
      });
    }
  }
}
