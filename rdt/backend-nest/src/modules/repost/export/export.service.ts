import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { deriveStateLabel } from '../rules/state-label';
import {
  ExportPayload,
  FormatTabExportService,
  FormatTabRow,
} from './format-tab-export.service';

// Port faithful dari `routes/exportBatches.js`. EXCLUDED/INVALID/NEEDS_INVESTIGATION sengaja di
// luar KEDUA set -- tak pernah masuk hitungan waiting/export.
export const BLOCKING_STATUSES = ['PENDING', 'DECLINED', 'NEEDS_REVIEW'];
export const ATTACHABLE_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR'];

interface WaitingRawRow {
  dinas_inisiasi: string;
  dinas_target: string;
  status_konfirmasi: string;
  declared_period: string | null;
  periode_efektif: string | null;
}

interface PairAccumulator {
  dinas_inisiasi: string;
  dinas_target: string;
  blocked: boolean;
  total: number;
  periodCounts: Record<string, number>;
  maxPeriodeEfektif: string | null;
}

export interface WaitingEntry {
  dinas_inisiasi: string;
  dinas_target: string;
  total: number;
  overdue: boolean;
  state_label: string;
}

export interface ExportLineRow {
  id: number;
  account: unknown;
  nominal: unknown;
  remark: unknown;
  ref_doc: unknown;
  subdoc_id: number | null;
  subdoc_number: string | null;
}

/**
 * `repost/export` — bagian BACA-SAJA (Batch 4a): port `routes/exportBatches.js`'s GET routes.
 * Tak ada tulis DB di sini sama sekali. Tulis (`POST confirm`, `POST :batchId/subdocs`) menyusul
 * di 4b/4c.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly formatTab: FormatTabExportService,
  ) {}

  // GET repost/export/waiting -- satu entri PER PASANGAN (dinas_inisiasi, dinas_target) yang
  // baris export_batch_id IS NULL-nya semuanya ATTACHABLE (nol yang BLOCKING). Agregasi di kode
  // (byPair accumulator), bukan SQL GROUP BY -- port pola lama apa adanya.
  async getWaiting(): Promise<WaitingEntry[]> {
    const { rows } = await this.db.query<WaitingRawRow>(
      `SELECT t.dinas_inisiasi, t.dinas_target, t.status_konfirmasi, u.period AS declared_period, t.periode_efektif
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.export_batch_id IS NULL AND t.dinas_target IS NOT NULL
         AND t.status_konfirmasi = ANY($1)`,
      [[...BLOCKING_STATUSES, ...ATTACHABLE_STATUSES]],
    );

    const byPair = new Map<string, PairAccumulator>();
    for (const t of rows) {
      const key = `${t.dinas_inisiasi} ${t.dinas_target}`;
      let entry = byPair.get(key);
      if (!entry) {
        entry = {
          dinas_inisiasi: t.dinas_inisiasi,
          dinas_target: t.dinas_target,
          blocked: false,
          total: 0,
          periodCounts: {},
          maxPeriodeEfektif: null,
        };
        byPair.set(key, entry);
      }
      if (BLOCKING_STATUSES.includes(t.status_konfirmasi)) {
        entry.blocked = true;
      } else {
        entry.total += 1;
      }
      if (t.declared_period) {
        entry.periodCounts[t.declared_period] =
          (entry.periodCounts[t.declared_period] || 0) + 1;
      }
      if (
        t.periode_efektif &&
        (!entry.maxPeriodeEfektif ||
          t.periode_efektif > entry.maxPeriodeEfektif)
      ) {
        entry.maxPeriodeEfektif = t.periode_efektif;
      }
    }

    // Overdue = sticky: periode-mayoritas (declared) vs maxPeriodeEfektif beda -> overdue
    // permanen (periode_efektif tak pernah "balik", lihat snapshotPeriodeEfektif 3b).
    const isOverdue = (p: PairAccumulator): boolean => {
      let declaredPeriod: string | null = null;
      let bestCount = 0;
      for (const [period, c] of Object.entries(p.periodCounts)) {
        if (c > bestCount) {
          declaredPeriod = period;
          bestCount = c;
        }
      }
      return !!(
        declaredPeriod &&
        p.maxPeriodeEfektif &&
        p.maxPeriodeEfektif !== declaredPeriod
      );
    };

    return Array.from(byPair.values())
      .filter((p) => !p.blocked && p.total > 0)
      .sort((a, b) =>
        (a.dinas_inisiasi + a.dinas_target).localeCompare(
          b.dinas_inisiasi + b.dinas_target,
        ),
      )
      .map((p) => ({
        dinas_inisiasi: p.dinas_inisiasi,
        dinas_target: p.dinas_target,
        total: p.total,
        overdue: isOverdue(p),
        state_label: deriveStateLabel({
          pendingCount: 0,
          targetDinas: p.dinas_target,
        }),
      }));
  }

  // GET repost/export/:batchId/lines -- tiap transaksi yang sudah nempel di batch ini, ditandai
  // subdoc mana (kalau ada) yang sudah nyakup dia.
  async getBatchLines(batchId: number): Promise<ExportLineRow[]> {
    const { rows } = await this.db.query<ExportLineRow>(
      `SELECT t.id, t.account, t.nominal, t.remark, t.ref_doc, t.subdoc_id, s.subdoc_number
       FROM rdt.transactions t
       LEFT JOIN rdt.export_subdocs s ON s.id = t.subdoc_id
       WHERE t.export_batch_id = $1
       ORDER BY t.id`,
      [batchId],
    );
    return rows;
  }

  // GET repost/export/transparency/:dinasInisiasi/:dinasTarget -- detail penuh baris
  // currently-unbatched satu pasangan, buat TAB review sebelum confirm.
  async getTransparency(
    dinasInisiasi: string,
    dinasTarget: string,
  ): Promise<Record<string, unknown>[]> {
    // SELECT * sengaja (bukan daftar kolom manual) -- preview harus ikut semua kolom transaksi
    // apa adanya, port faithful.
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT *
       FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL
         AND status_konfirmasi = ANY($3)
       ORDER BY id`,
      [
        dinasInisiasi,
        dinasTarget,
        [...BLOCKING_STATUSES, ...ATTACHABLE_STATUSES],
      ],
    );
    return rows;
  }

  // GET repost/export/export/:batchId -- Format TAB, CONFIRMED-only, buat batch yang sudah ada.
  async exportBatch(batchId: number): Promise<ExportPayload> {
    const { rows } = await this.db.query<{
      dinas_inisiasi: string;
      dinas_target: string;
    }>(
      'SELECT dinas_inisiasi, dinas_target FROM rdt.export_batches WHERE id=$1',
      [batchId],
    );
    if (!rows.length) {
      throw new DomainError(
        `batch not found: ${batchId}`,
        404,
        'EXPORT_BATCH_NOT_FOUND',
      );
    }
    const { dinas_inisiasi: dinasInisiasi, dinas_target: dinasTarget } =
      rows[0];
    const { rows: exportRows } = await this.db.query<FormatTabRow>(
      `SELECT dinas_inisiasi, dinas_target, account, nominal, curr, ref_doc, period
       FROM rdt.transactions
       WHERE export_batch_id=$1 AND status_konfirmasi='CONFIRMED'
       ORDER BY id`,
      [batchId],
    );
    return this.formatTab.buildExportPayload(
      exportRows,
      dinasInisiasi,
      dinasTarget,
    );
  }

  // GET repost/export/export-pair/:dinasInisiasi/:dinasTarget -- sama seperti exportBatch, tapi
  // baca langsung dari pasangan (export_batch_id IS NULL), tanpa batch -- pure read, tak ada
  // state berubah, tersedia sebelum TAB confirm sama sekali.
  async exportPair(
    dinasInisiasi: string,
    dinasTarget: string,
  ): Promise<ExportPayload> {
    const { rows } = await this.db.query<FormatTabRow>(
      `SELECT dinas_inisiasi, dinas_target, account, nominal, curr, ref_doc, period
       FROM rdt.transactions
       WHERE dinas_inisiasi=$1 AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi='CONFIRMED'
       ORDER BY id`,
      [dinasInisiasi, dinasTarget],
    );
    return this.formatTab.buildExportPayload(rows, dinasInisiasi, dinasTarget);
  }
}
