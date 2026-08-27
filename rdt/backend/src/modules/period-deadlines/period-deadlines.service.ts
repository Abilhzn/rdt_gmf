import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../core/database/database.service';
import { DomainError } from '../../core/errors/domain-error';
import {
  ATTACHABLE_STATUSES,
  BLOCKING_STATUSES,
} from '../repost/export/export.service';
import { buildValidCodeMap } from '../repost/rules/reassignment-rules';
import { currentAutoPeriode } from '../repost/rules/period-effective';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';
import {
  PERIODE_RE,
  validatePeriodAndDeadline,
} from './validate-period-and-deadline';

// `SELECT *` shape -- loosely typed (Record), sama pola dengan `ExportService.getTransparency`.
export type PeriodDeadlineRow = Record<string, unknown>;
export type PeriodDefaultDeadlineRow = Record<string, unknown>;

export interface OverduePair {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  periode_efektif: string;
}

export interface ActivePair {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  open_count: number;
}

/**
 * `period-deadlines` — port `routes/periodDeadlines.js` (Batch 5.5a). TAB set deadline konfirmasi
 * PER PASANGAN × periode, dikonsumsi `snapshotPeriodeEfektif` (3b) lewat `pickDeadline` (3a).
 * CRUD murni tabel deadline -- tak ada logic snapshot di sini.
 *
 * ⚠️ Endpoint `POST /override-reevaluate` di kode lama SUDAH DIHAPUS di sana sendiri (bukan
 * kelalaian) -- JANGAN di-port, tak ada aksi un-stick buat overdue pair, `GET overdue` murni
 * informational.
 */
@Injectable()
export class PeriodDeadlinesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rollbackAudit: RollbackAuditService,
  ) {}

  // GET period-deadlines/current-reminder -- SEMUA user login. Deadline default periode SEKARANG
  // (bukan per-pasangan spesifik -- banner reminder tak butuh presisi itu, dan caller non-TAB di
  // sini selalu PIC yang belum tentu tahu himpunan pasangannya di muka).
  async getCurrentReminder(): Promise<{
    periode: string;
    deadline_at: unknown;
  }> {
    const periode = currentAutoPeriode();
    const { rows } = await this.db.query<{ deadline_at: unknown }>(
      'SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode = $1',
      [periode],
    );
    return { periode, deadline_at: rows[0]?.deadline_at ?? null };
  }

  // GET period-deadlines -- filter dinamis opsional dinas_inisiasi/dinas_target.
  async listDeadlines(
    dinasInisiasi?: string,
    dinasTarget?: string,
  ): Promise<PeriodDeadlineRow[]> {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (dinasInisiasi) {
      whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
      params.push(dinasInisiasi);
    }
    if (dinasTarget) {
      whereParts.push(`dinas_target = $${params.length + 1}`);
      params.push(dinasTarget);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const { rows } = await this.db.query<PeriodDeadlineRow>(
      `SELECT * FROM rdt.period_deadlines ${where} ORDER BY periode DESC, dinas_inisiasi, dinas_target`,
      params,
    );
    return rows;
  }

  // POST period-deadlines -- override per-PASANGAN. Upsert: set ulang triple yang sama
  // meng-UPDATE baris yang ada (bukan bikin duplikat/error).
  async upsertDeadline(args: {
    rawDinasInisiasi: unknown;
    rawDinasTarget: unknown;
    rawPeriode: unknown;
    rawDeadlineAt: unknown;
    userId: string;
  }): Promise<PeriodDeadlineRow> {
    const {
      rawDinasInisiasi,
      rawDinasTarget,
      rawPeriode,
      rawDeadlineAt,
      userId,
    } = args;
    if (!rawDinasInisiasi || !rawDinasTarget) {
      throw new DomainError(
        'dinas_inisiasi and dinas_target are required',
        400,
        'DINAS_REQUIRED',
      );
    }
    const validation = validatePeriodAndDeadline({
      periode: rawPeriode,
      deadline_at: rawDeadlineAt,
    });
    if (!validation.ok) {
      throw new DomainError(
        validation.error,
        400,
        'INVALID_PERIOD_OR_DEADLINE',
      );
    }
    const { deadlineAt } = validation;
    const periode = rawPeriode as string;

    const { rows: dinasRows } = await this.db.query<{ code: string }>(
      'SELECT code FROM rdt.dinas WHERE is_active = true',
    );
    const validCodes = buildValidCodeMap(dinasRows);
    // port apa adanya; dinas_inisiasi/dinas_target selalu string di praktiknya (dari DTO
    // @IsString()).
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const dinasInisiasiStr = String(rawDinasInisiasi);
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const dinasTargetStr = String(rawDinasTarget);
    const matchedInisiasi = validCodes.get(dinasInisiasiStr.toUpperCase());
    const matchedTarget = validCodes.get(dinasTargetStr.toUpperCase());
    if (!matchedInisiasi) {
      throw new DomainError(
        `dinas_inisiasi '${dinasInisiasiStr}' is not a known active dinas`,
        400,
        'UNKNOWN_DINAS_INISIASI',
      );
    }
    if (!matchedTarget) {
      throw new DomainError(
        `dinas_target '${dinasTargetStr}' is not a known active dinas`,
        400,
        'UNKNOWN_DINAS_TARGET',
      );
    }

    // Single statement, tak perlu withTransaction.
    const { rows } = await this.db.query<PeriodDeadlineRow>(
      `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dinas_inisiasi, dinas_target, periode)
       DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
       RETURNING *`,
      [
        matchedInisiasi,
        matchedTarget,
        periode,
        deadlineAt.toISOString(),
        userId,
      ],
    );
    return rows[0];
  }

  // GET period-deadlines/default
  async listDefaults(): Promise<PeriodDefaultDeadlineRow[]> {
    const { rows } = await this.db.query<PeriodDefaultDeadlineRow>(
      'SELECT * FROM rdt.period_default_deadlines ORDER BY periode DESC',
    );
    return rows;
  }

  // POST period-deadlines/default -- upsert default PERIODE ITU SENDIRI + sweep ke pasangan yang
  // SUDAH punya transaksi non-terminal di periode itu, satu transaksi (no partial-success).
  async upsertDefault(args: {
    rawPeriode: unknown;
    rawDeadlineAt: unknown;
    userId: string;
    ip: string | null;
  }): Promise<{
    deadline: PeriodDefaultDeadlineRow;
    swept: PeriodDeadlineRow[];
  }> {
    const validation = validatePeriodAndDeadline({
      periode: args.rawPeriode,
      deadline_at: args.rawDeadlineAt,
    });
    if (!validation.ok) {
      throw new DomainError(
        validation.error,
        400,
        'INVALID_PERIOD_OR_DEADLINE',
      );
    }
    const { deadlineAt } = validation;
    const periode = args.rawPeriode as string;

    try {
      return await this.db.withTransaction((client) =>
        this.runUpsertDefault(client, {
          periode,
          deadlineAt,
          userId: args.userId,
        }),
      );
    } catch (err) {
      throw await this.wrapRollback(err, args.userId, args.ip);
    }
  }

  private async runUpsertDefault(
    client: PoolClient,
    params: { periode: string; deadlineAt: Date; userId: string },
  ): Promise<{
    deadline: PeriodDefaultDeadlineRow;
    swept: PeriodDeadlineRow[];
  }> {
    const { periode, deadlineAt, userId } = params;
    const defaultRes = await client.query<PeriodDefaultDeadlineRow>(
      `INSERT INTO rdt.period_default_deadlines (periode, deadline_at, set_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (periode)
       DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
       RETURNING *`,
      [periode, deadlineAt.toISOString(), userId],
    );

    // ⚠️ `$2::timestamptz` cast eksplisit WAJIB dipertahankan -- tanpa itu Postgres gagal infer
    // tipe parameter di posisi SELECT-list ini (beda dari posisi lain yang infer otomatis dari
    // kolom tabel).
    const sweptRes = await client.query<PeriodDeadlineRow>(
      `INSERT INTO rdt.period_deadlines (dinas_inisiasi, dinas_target, periode, deadline_at, set_by_user_id)
       SELECT DISTINCT t.dinas_inisiasi, t.dinas_target, $1, $2::timestamptz, $3
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.status_konfirmasi = ANY($4)
       ON CONFLICT (dinas_inisiasi, dinas_target, periode)
       DO UPDATE SET deadline_at = EXCLUDED.deadline_at, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = now()
       RETURNING *`,
      [periode, deadlineAt.toISOString(), userId, BLOCKING_STATUSES],
    );

    return { deadline: defaultRes.rows[0], swept: sweptRes.rows };
  }

  // DELETE period-deadlines/default/:periode -- HANYA kalau deadline masih di masa depan (jaga
  // integritas jejak audit; histori periode yang sudah lewat dipertahankan).
  async deleteDefault(rawPeriode: unknown): Promise<{ periode: string }> {
    const periode = this.requireValidPeriode(rawPeriode);
    const { rows } = await this.db.query<{ deadline_at: unknown }>(
      'SELECT deadline_at FROM rdt.period_default_deadlines WHERE periode = $1',
      [periode],
    );
    if (!rows.length) {
      throw new DomainError(
        `no default deadline set for periode ${periode}`,
        404,
        'DEFAULT_DEADLINE_NOT_FOUND',
      );
    }
    const deadlineAt = rows[0].deadline_at as string | Date;
    if (new Date(deadlineAt).getTime() <= Date.now()) {
      throw new DomainError(
        `deadline periode ${periode} sudah lewat — tidak bisa dihapus, cuma bisa dihapus sebelum waktunya`,
        400,
        'DEADLINE_ALREADY_PASSED',
      );
    }
    await this.db.query(
      'DELETE FROM rdt.period_default_deadlines WHERE periode = $1',
      [periode],
    );
    return { periode };
  }

  // GET period-deadlines/overdue?periode= -- pasangan export_batch_id IS NULL, 100% resolved
  // (ATTACHABLE), TAPI periode_efektif (MAX) sudah bergeser dari periode declared. Informational
  // only -- tak ada aksi un-stick, list ini permanen.
  async getOverdue(
    rawPeriode: unknown,
  ): Promise<{ periode: string; overdue: OverduePair[] }> {
    const periode = this.requireValidPeriode(rawPeriode);
    const { rows } = await this.db.query<{
      dinas_inisiasi: string;
      dinas_target: string;
      total: number;
      periode_efektif: string;
    }>(
      `SELECT t.dinas_inisiasi, t.dinas_target,
              COUNT(*)::int AS total,
              MAX(t.periode_efektif) AS periode_efektif
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.export_batch_id IS NULL
       GROUP BY t.dinas_inisiasi, t.dinas_target
       HAVING COUNT(*) = COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2))
          AND MAX(t.periode_efektif) IS NOT NULL AND MAX(t.periode_efektif) <> $1
       ORDER BY t.dinas_inisiasi, t.dinas_target`,
      [periode, ATTACHABLE_STATUSES],
    );
    return {
      periode,
      overdue: rows.map((r) => ({
        dinas_inisiasi: r.dinas_inisiasi,
        dinas_target: r.dinas_target,
        total: r.total,
        periode_efektif: r.periode_efektif,
      })),
    };
  }

  // GET period-deadlines/active-pairs?periode= -- pasangan yang MASIH punya baris belum resolved
  // (BLOCKING) di periode ini, un-batched. SENGAJA endpoint/query terpisah dari getOverdue di
  // atas (bukan digabung) -- port apa adanya, biar tetap single-purpose.
  async getActivePairs(
    rawPeriode: unknown,
  ): Promise<{ periode: string; active: ActivePair[] }> {
    const periode = this.requireValidPeriode(rawPeriode);
    const { rows } = await this.db.query<ActivePair>(
      `SELECT t.dinas_inisiasi, t.dinas_target, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2))::int AS open_count
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE u.period = $1 AND t.dinas_target IS NOT NULL AND t.export_batch_id IS NULL
       GROUP BY t.dinas_inisiasi, t.dinas_target
       HAVING COUNT(*) FILTER (WHERE t.status_konfirmasi = ANY($2)) > 0
       ORDER BY t.dinas_inisiasi, t.dinas_target`,
      [periode, BLOCKING_STATUSES],
    );
    return { periode, active: rows };
  }

  private requireValidPeriode(raw: unknown): string {
    const periode = typeof raw === 'string' ? raw : '';
    if (!periode || !PERIODE_RE.test(periode)) {
      throw new DomainError(
        "periode must be 'YYYY-MM'",
        400,
        'INVALID_PERIODE',
      );
    }
    return periode;
  }

  // Pola sama seperti Persist/ExportConfirm/ExportSubdoc/DashboardDetail.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'period-deadlines/default',
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
    return new DomainError(
      message,
      500,
      'PERIOD_DEADLINE_DEFAULT_FAILED',
      category,
    );
  }
}
