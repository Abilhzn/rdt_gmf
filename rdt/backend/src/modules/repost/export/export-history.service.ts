import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import type { Identity } from '../../../core/security/identity.interface';
import { deriveStateLabel } from '../rules/state-label';

export interface HistoryBatchRow {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  [column: string]: unknown;
}

export interface HistorySubdoc {
  id: number;
  subdoc_number: string;
  created_at: Date | string;
  transaction_ids: number[];
}

export interface HistoryBatch extends HistoryBatchRow {
  period: string | null;
  period_efektif: string | null;
  overdue: boolean;
  subdocs: HistorySubdoc[];
  subdoc_numbers: string[];
  state_label: string;
}

/**
 * `GET repost/export/history` — port `GET /history` (Batch 4c). "Riwayat Repost TAB/Dinas".
 * ⚠️ BUKAN TAB-only (beda dari semua endpoint 4a/4b) -- TAB lihat semua batch, non-TAB
 * force-scoped ke `dinas_inisiasi == user.dinas` server-side (tak ada bypass lewat query param,
 * caller non-TAB tak pernah bisa minta dinas lain). Read-only, tanpa transaksi.
 */
@Injectable()
export class ExportHistoryService {
  constructor(private readonly db: DatabaseService) {}

  async getHistory(user: Identity, periode?: string): Promise<HistoryBatch[]> {
    const whereParts = [
      'EXISTS (SELECT 1 FROM rdt.export_subdocs s WHERE s.batch_id = b.id)',
    ];
    const params: unknown[] = [];
    if (user.role !== 'TAB') {
      whereParts.push(`b.dinas_inisiasi = $${params.length + 1}`);
      params.push(user.dinas);
    }
    const { rows } = await this.db.query<HistoryBatchRow>(
      `SELECT b.* FROM rdt.export_batches b WHERE ${whereParts.join(' AND ')} ORDER BY b.confirmed_at DESC`,
      params,
    );
    const batchIds = rows.map((b) => Number(b.id));

    const subdocsByBatch = await this.loadSubdocsByBatch(batchIds);
    const periodByBatch = await this.loadDeclaredPeriodByBatch(batchIds);
    const effectiveByBatch = await this.loadEffectivePeriodByBatch(batchIds);

    const batches: HistoryBatch[] = rows.map((b) => {
      const batchId = Number(b.id);
      const subdocs = subdocsByBatch.get(batchId) ?? [];
      const subdocNumbers = subdocs.map((s) => s.subdoc_number);
      const period = periodByBatch.get(batchId) ?? null;
      const periodEfektif = effectiveByBatch.get(batchId) ?? period;
      const overdue = !!(period && periodEfektif && periodEfektif !== period);
      return {
        ...b,
        period,
        period_efektif: periodEfektif,
        overdue,
        subdocs,
        subdoc_numbers: subdocNumbers,
        state_label: deriveStateLabel({
          pendingCount: 0,
          targetDinas: b.dinas_target,
          subdocNumbers,
        }),
      };
    });

    // Filter by periode (declared, falling back to effective) AFTER derivation -- not in the
    // WHERE clause above (port faithful, same precedence as the old route).
    return periode
      ? batches.filter((b) => (b.period_efektif || b.period) === periode)
      : batches;
  }

  private async loadSubdocsByBatch(
    batchIds: number[],
  ): Promise<Map<number, HistorySubdoc[]>> {
    const map = new Map<number, HistorySubdoc[]>();
    if (!batchIds.length) return map;
    // Which transaction ids each subdoc actually covers -- a batch split across several subdocs
    // needs this to answer "which lines are in which subdoc" from the history view too, not just
    // the TAB-only /:batchId/lines picker.
    const { rows } = await this.db.query<{
      id: number;
      batch_id: number;
      subdoc_number: string;
      created_at: Date | string;
      transaction_ids: number[];
    }>(
      `SELECT s.id, s.batch_id, s.subdoc_number, s.created_at,
              COALESCE(array_agg(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '{}') AS transaction_ids
       FROM rdt.export_subdocs s
       LEFT JOIN rdt.transactions t ON t.subdoc_id = s.id
       WHERE s.batch_id = ANY($1)
       GROUP BY s.id
       ORDER BY s.created_at ASC, s.id ASC`,
      [batchIds],
    );
    for (const s of rows) {
      const batchId = Number(s.batch_id);
      const list = map.get(batchId) ?? [];
      list.push({
        id: Number(s.id),
        subdoc_number: s.subdoc_number,
        created_at: s.created_at,
        transaction_ids: s.transaction_ids.map(Number),
      });
      map.set(batchId, list);
    }
    return map;
  }

  // rdt.export_batches has no period column of its own -- a batch's "period" is derived from the
  // uploads its transactions came from. Normally one upload/period; if it legitimately spans more
  // than one, the most common (modus) period wins -- deterministic, not an arbitrary pick (`ORDER
  // BY c DESC, period DESC` + take the first row per batch).
  private async loadDeclaredPeriodByBatch(
    batchIds: number[],
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!batchIds.length) return map;
    const { rows } = await this.db.query<{
      batch_id: number;
      period: string;
      c: number;
    }>(
      `SELECT t.export_batch_id AS batch_id, u.period, COUNT(*)::int AS c
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE t.export_batch_id = ANY($1) AND u.period IS NOT NULL
       GROUP BY t.export_batch_id, u.period
       ORDER BY t.export_batch_id, c DESC, u.period DESC`,
      [batchIds],
    );
    for (const row of rows) {
      const batchId = Number(row.batch_id);
      if (!map.has(batchId)) map.set(batchId, row.period);
    }
    return map;
  }

  // period_efektif adalah SNAPSHOT, dikunci saat dinas TARGET Confirm/Decline (3b), BUKAN
  // dihitung ulang di sini. MAX ("worst case") di antara transaksi batch itu; NULL (baris lama/
  // tanpa periode declared) di-skip otomatis oleh MAX dan fallback ke declared period di caller.
  private async loadEffectivePeriodByBatch(
    batchIds: number[],
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!batchIds.length) return map;
    const { rows } = await this.db.query<{
      batch_id: number;
      max_effective: string;
    }>(
      `SELECT export_batch_id AS batch_id, MAX(periode_efektif) AS max_effective
       FROM rdt.transactions WHERE export_batch_id = ANY($1)
       GROUP BY export_batch_id`,
      [batchIds],
    );
    for (const row of rows) {
      map.set(Number(row.batch_id), row.max_effective);
    }
    return map;
  }
}
