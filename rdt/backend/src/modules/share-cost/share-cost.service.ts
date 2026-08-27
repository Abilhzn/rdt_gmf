import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../core/database/database.service';
import { DomainError } from '../../core/errors/domain-error';
import { validateFreeText } from '../../core/utils/text-validation';
import { buildValidCodeMap } from '../repost/rules/reassignment-rules';
import { PairCommentService } from '../repost/shared/pair-comment.service';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';

export type ShareCostCandidateRow = Record<string, unknown>;

interface RawSplitInput {
  dinas_target?: unknown;
  nominal?: unknown;
}

interface SplitInput {
  dinas_target: string;
  nominal: number;
}

interface OriginalTransactionRow {
  id: number;
  status_konfirmasi: string;
  dinas_inisiasi: string;
  dinas_target: string;
  nominal: string;
}

export interface SplitResult {
  split_from: number;
  split_into: number[];
}

/**
 * `share-cost` — port `routes/shareCost.js` (Batch 5.5b, penutup Batch 5.5). TAB membelah SATU
 * baris PENDING jadi beberapa baris `(dinas_target, nominal)` berbeda. Locked ke PENDING-only --
 * baris CONFIRMED sudah punya `ledger_entries`, butuh desain reversal terpisah (di luar scope).
 * Baris asli ditandai `SPLIT_VOID` (mati permanen dari semua alur aktif, skema+status sudah ada
 * dari migration `012_share_cost_split.sql`, di-port utuh Batch 0.5 -- tak ada migration baru).
 */
@Injectable()
export class ShareCostService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pairComment: PairCommentService,
    private readonly rollbackAudit: RollbackAuditService,
  ) {}

  // GET share-cost/candidates?q= -- baris PENDING milik dinas_target='TAB' persis (nilai
  // tersimpan, bukan join is_active). q opsional -> ILIKE account/ref_doc/remark.
  async getCandidates(rawQ: unknown): Promise<ShareCostCandidateRow[]> {
    const q = typeof rawQ === 'string' ? rawQ.trim() : '';
    const params: unknown[] = [];
    let where = `t.status_konfirmasi = 'PENDING' AND t.dinas_target = 'TAB'`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (t.account ILIKE $${params.length} OR t.ref_doc ILIKE $${params.length} OR t.remark ILIKE $${params.length})`;
    }
    const { rows } = await this.db.query<ShareCostCandidateRow>(
      `SELECT t.id, t.dinas_inisiasi, t.dinas_target, t.account, t.nominal, t.remark, t.ref_doc, t.period,
              t.upload_id, u.original_filename AS upload_filename
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT 100`,
      params,
    );
    return rows;
  }

  // POST share-cost/:transactionId/split
  async splitTransaction(args: {
    transactionId: number;
    rawSplits: unknown;
    rawNote: unknown;
    userId: string;
    ip: string | null;
  }): Promise<SplitResult> {
    const { transactionId, userId, ip } = args;

    // Pra-transaksi: note wajib (alasan split masuk audit trail), splits harus array valid.
    const noteCheck = validateFreeText(args.rawNote, {
      required: true,
      fieldLabel: 'note (alasan split)',
    });
    if (!noteCheck.ok) {
      throw new DomainError(noteCheck.error, 400, noteCheck.code);
    }
    const note = noteCheck.value;
    if (!note) {
      // Tak akan pernah tercapai (required:true di atas sudah menjamin ini), tapi menjaga tipe
      // tetap `string` tanpa non-null assertion.
      throw new DomainError('note wajib diisi', 400, 'REQUIRED');
    }
    const splits = this.parseSplits(args.rawSplits);

    try {
      return await this.db.withTransaction((client) =>
        this.runSplit(client, { transactionId, splits, note, userId, ip }),
      );
    } catch (err) {
      throw await this.wrapRollback(err, userId, ip, transactionId);
    }
  }

  private parseSplits(rawSplits: unknown): SplitInput[] {
    if (!Array.isArray(rawSplits) || rawSplits.length < 2) {
      throw new DomainError(
        'splits harus berisi minimal 2 baris',
        400,
        'SPLITS_MIN_TWO',
      );
    }
    return rawSplits.map((raw) => {
      const s = raw as RawSplitInput;
      if (
        !s ||
        !s.dinas_target ||
        typeof s.nominal !== 'number' ||
        !Number.isFinite(s.nominal) ||
        s.nominal === 0
      ) {
        throw new DomainError(
          'setiap baris split wajib punya dinas_target dan nominal (angka, tidak nol)',
          400,
          'INVALID_SPLIT_ROW',
        );
      }
      // port apa adanya; dinas_target selalu string di praktiknya (dari body JSON).
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return { dinas_target: String(s.dinas_target), nominal: s.nominal };
    });
  }

  private async runSplit(
    client: PoolClient,
    params: {
      transactionId: number;
      splits: SplitInput[];
      note: string;
      userId: string;
      ip: string | null;
    },
  ): Promise<SplitResult> {
    const { transactionId, note, userId, ip } = params;

    const { rows } = await client.query<OriginalTransactionRow>(
      'SELECT id, status_konfirmasi, dinas_inisiasi, dinas_target, nominal FROM rdt.transactions WHERE id=$1 FOR UPDATE',
      [transactionId],
    );
    if (!rows.length) {
      throw new DomainError(
        `transaction not found: ${transactionId}`,
        404,
        'TRANSACTION_NOT_FOUND',
      );
    }
    const original = rows[0];
    if (original.status_konfirmasi !== 'PENDING') {
      throw new DomainError(
        `hanya baris PENDING yang bisa di-split (baris ini: ${original.status_konfirmasi})`,
        409,
        'NOT_PENDING',
      );
    }

    // rdt.dinas menyimpan beberapa kode mixed-case ('Corp') -- resolve tiap split.dinas_target ke
    // kode stored-case-nya SEKALI di sini, dipakai lagi saat INSERT di bawah, supaya submission
    // case-mismatch tak lolos validasi tapi tetap melanggar FK saat insert.
    const { rows: dinasRows } = await client.query<{ code: string }>(
      'SELECT code FROM rdt.dinas WHERE is_active = true',
    );
    const validCodes = buildValidCodeMap(dinasRows);
    const resolvedSplits = params.splits.map((s) => {
      const matched = validCodes.get(s.dinas_target.toUpperCase());
      if (!matched) {
        throw new DomainError(
          `dinas_target tidak valid: ${s.dinas_target}`,
          400,
          'INVALID_SPLIT_DINAS_TARGET',
        );
      }
      return { dinas_target: matched, nominal: s.nominal };
    });

    // SUM nominal seluruh baris hasil split HARUS PERSIS SAMA dengan nominal baris asli --
    // dibandingkan dalam SEN (integer) supaya tidak salah karena floating point.
    const originalCents = Math.round(Number(original.nominal) * 100);
    const sumCents = resolvedSplits.reduce(
      (acc, s) => acc + Math.round(s.nominal * 100),
      0,
    );
    if (sumCents !== originalCents) {
      throw new DomainError(
        `SUM nominal split (${(sumCents / 100).toFixed(2)}) harus persis sama dengan nominal baris asli (${(originalCents / 100).toFixed(2)})`,
        400,
        'SPLIT_SUM_MISMATCH',
      );
    }

    await client.query(
      `UPDATE rdt.transactions SET status_konfirmasi='SPLIT_VOID' WHERE id=$1`,
      [original.id],
    );

    // Per split -- INSERT...SELECT copy-forward SEMUA kolom non-override dari baris asli (port
    // PERSIS daftar kolom kode lama; sebagian besar kolom "contract lama" akan NULL karena parser
    // Format CBO, itu diharapkan -- sama seperti pola persist 3.5b/duplicate-check 3.5a).
    const newIds: number[] = [];
    for (const s of resolvedSplits) {
      const insertRes = await client.query<{ id: number }>(
        `INSERT INTO rdt.transactions (
           upload_id, dinas_inisiasi, dinas_target, nominal, category, status_konfirmasi, is_reversal, invalid_reason,
           account, cost_ctr, profit_ctr, partner_pc, document_no, ref_doc, period, text_desc, acc_text, sap_user,
           sales_doc, wbs_elem, purch_doc, order_no, fiscal_year, elim_prctr, obj_class, customer, vendor, plant,
           material, time_val, year_2, ref_org_un, val_a, mvt, type, sales_ord, s_no, bus_a, func_area, acty,
           asset, rep_mat, ar, dt, ref_tran, item, bill_t, sd_doc, s_grp, s_off, co_ar, in_pclc, curr,
           doc_date, pstng_date, in_ccc, in_tc, qty, unit, entry_dte, value_date,
           sheet_name, raw_row_index, remark, raw_payload, sub_group, split_from_transaction_id
         )
         SELECT
           upload_id, dinas_inisiasi, $2, $3, category, 'PENDING', is_reversal, invalid_reason,
           account, cost_ctr, profit_ctr, partner_pc, document_no, ref_doc, period, text_desc, acc_text, sap_user,
           sales_doc, wbs_elem, purch_doc, order_no, fiscal_year, elim_prctr, obj_class, customer, vendor, plant,
           material, time_val, year_2, ref_org_un, val_a, mvt, type, sales_ord, s_no, bus_a, func_area, acty,
           asset, rep_mat, ar, dt, ref_tran, item, bill_t, sd_doc, s_grp, s_off, co_ar, in_pclc, curr,
           doc_date, pstng_date, in_ccc, in_tc, qty, unit, entry_dte, value_date,
           sheet_name, raw_row_index, remark, raw_payload, sub_group, $1
         FROM rdt.transactions WHERE id=$1
         RETURNING id`,
        [original.id, s.dinas_target, s.nominal],
      );
      newIds.push(Number(insertRes.rows[0].id));
    }

    await client.query(
      'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        userId,
        original.id,
        'SPLIT_BY_TAB',
        'PENDING',
        'SPLIT_VOID',
        JSON.stringify({ split_into: newIds, note, splits: resolvedSplits }),
        ip,
      ],
    );

    // Comment + notifikasi di thread PASANGAN ASLI (dinas_inisiasi -> dinas_target ASLI, mis.
    // 'TAB' -- BUKAN target hasil split manapun). Verifikasi: logic "cari root top-level
    // pasangan itu, reply-kalau-ada else top-level baru, mention+implicit-recipient" di kode lama
    // SAMA PERSIS dengan PairCommentService (3c) -- query root, urutan ORDER BY, fallback anchor,
    // dan resolusi penerima semuanya identik. REUSE di sini (kandidat pertama yang genuinely
    // cocok, beda dari export-confirm 4b & dashboard-detail 5c yang sengaja divergen).
    const splitSummary = resolvedSplits
      .map((s) => `${s.dinas_target} ${s.nominal}`)
      .join(', ');
    const commentBody = `[Share-Cost split oleh TAB] Baris ini dibelah jadi: ${splitSummary}. ${note}`;
    await this.pairComment.post(client, {
      dinasInisiasi: original.dinas_inisiasi,
      dinasTarget: original.dinas_target,
      implicitRecipientDinas: original.dinas_target,
      fallbackTransactionId: Number(original.id),
      authorUserId: userId,
      body: commentBody,
    });

    return { split_from: Number(original.id), split_into: newIds };
  }

  // Pola sama seperti Persist/ExportConfirm/ExportSubdoc/DashboardDetail/PeriodDeadlines.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
    transactionId: number,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'share-cost/:transactionId/split',
      transactionId,
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
    return new DomainError(message, 500, 'SHARE_COST_SPLIT_FAILED', category);
  }
}
