import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import type { Identity } from '../../core/security/identity.interface';
import { deriveStateLabel } from '../repost/rules/state-label';
import {
  ACTIONABLE_STATUSES,
  OPEN_STATUSES,
  RESOLVED_STATUSES,
} from './dashboard.constants';
import {
  fetchInvestigationCounts,
  fetchReassignChainMap,
  fetchReplyCounts,
} from './shared/dashboard-query-helpers';

// Kartu progress per pasangan/target -- field opsional benar-benar absen sesuai cabang JS lama
// (bukan sekadar undefined-tapi-declared), lihat tiap pemakaian di bawah.
export interface DashboardProgressCard {
  dinas: string;
  target_dinas?: string;
  total: number;
  resolved: number;
  open?: number;
  percent: number;
  declined_pending_action?: number;
  reply_count: number;
  state_label?: string;
  chain?: string[];
  overdue?: boolean;
}

export interface DashboardSummary {
  own_dinas: string;
  as_initiator: DashboardProgressCard[];
  need_to_confirm: DashboardProgressCard[];
  is_global_view: boolean;
}

export type DashboardKpis =
  | {
      is_global_view: false;
      total_transaksi: number;
      total_nilai: number;
      pasangan_count: number;
      open_count: number;
      resolved_count: number;
    }
  | {
      is_global_view: true;
      dinas_aktif: number;
      total_transaksi: number;
      butuh_investigasi: number;
      waiting_to_repost: number;
      reposted: number;
    };

export interface PerDinasRollupRow {
  dinas: string;
  total: number;
  confirmed: number;
  open: number;
  declined: number;
  percent: number;
  status: { kind: string; label: string } | null;
}

interface ActionableTxnRow {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string;
  status_konfirmasi: string;
  reassign_count: number;
  export_batch_id: number | null;
  declared_period: string | null;
  periode_efektif: string | null;
}

interface PairAgg {
  dinasInisiasi: string;
  target: string;
  total: number;
  resolved: number;
  pending: number;
  declinedPendingAction: number;
  replyCount: number;
  batchIds: Set<number>;
  hasUnbatchedResolved: boolean;
  chain: string[];
  chainConsistent: boolean;
  periodCounts: Record<string, number>;
  maxPeriodeEfektif: string | null;
}

// declaredPeriod ter-mayoritas (modus, BUKAN terbaru) di antara periodCounts -- pola yang sama
// dipakai buildChainAwareProgress/buildNeedToConfirmProgress/ExportHistoryService (4c).
function majorityPeriod(periodCounts: Record<string, number>): string | null {
  let declaredPeriod: string | null = null;
  let bestCount = 0;
  for (const [period, c] of Object.entries(periodCounts)) {
    if (c > bestCount) {
      declaredPeriod = period;
      bestCount = c;
    }
  }
  return declaredPeriod;
}

/**
 * `dashboard` — bagian BACA-SAJA (Batch 5b): port `routes/dashboard.js`'s `/summary`,
 * `/need-to-confirm-count`, `/kpis`, `/per-dinas-rollup`, `/summary/:dinasInisiasi/breakdown`.
 * Detail pasangan + comment thread (ada tulis DB) menyusul di 5c.
 *
 * ⚠️ Logika di sini penuh aturan halus (chain-tracking, period-majority, visibility-cutoff) --
 * port apa adanya, JANGAN disederhanakan. Baca komentar tiap method untuk alasan bisnisnya.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  // GET dashboard/summary
  async getSummary(user: Identity): Promise<DashboardSummary> {
    const myDinas = user.dinas;
    const isTabStaff = user.role === 'TAB';
    const asInitiator = isTabStaff
      ? await this.buildChainAwareProgress({
          initiatorDinas: null,
          groupBy: 'pair',
        })
      : await this.buildChainAwareProgress({
          initiatorDinas: myDinas,
          groupBy: 'target',
        });
    const needToConfirm = await this.buildNeedToConfirmProgress(
      this.needToConfirmTargetCodes(myDinas, isTabStaff),
      isTabStaff,
    );
    return {
      own_dinas: myDinas,
      as_initiator: asInitiator,
      need_to_confirm: needToConfirm,
      is_global_view: isTabStaff,
    };
  }

  // GET dashboard/need-to-confirm-count -- versi murah utk badge sidebar (bare count, bukan
  // buildNeedToConfirmProgress's kartu kaya percent/reply-count).
  async getNeedToConfirmCount(user: Identity): Promise<number> {
    const isTabStaff = user.role === 'TAB';
    const targetCodes = this.needToConfirmTargetCodes(user.dinas, isTabStaff);
    const dinasList = await this.fetchNeedToConfirmDinas(
      targetCodes,
      isTabStaff,
    );
    return dinasList.length;
  }

  // GET dashboard/kpis -- shape beda TOTAL per role (bukan superset).
  async getKpis(user: Identity): Promise<DashboardKpis> {
    if (user.role !== 'TAB') {
      const { rows } = await this.db.query<{
        total: number;
        total_nilai: number;
        open_count: number;
        pasangan_count: number;
      }>(
        `SELECT
           COUNT(*)::int AS total,
           COALESCE(SUM(nominal), 0)::float AS total_nilai,
           COUNT(*) FILTER (WHERE status_konfirmasi = ANY($2))::int AS open_count,
           COUNT(DISTINCT dinas_target)::int AS pasangan_count
         FROM rdt.transactions
         WHERE dinas_inisiasi = $1 AND dinas_target IS NOT NULL AND status_konfirmasi = ANY($3)`,
        [user.dinas, OPEN_STATUSES, ACTIONABLE_STATUSES],
      );
      const row = rows[0];
      return {
        is_global_view: false,
        total_transaksi: row.total,
        total_nilai: row.total_nilai,
        pasangan_count: row.pasangan_count,
        open_count: row.open_count,
        resolved_count: row.total - row.open_count,
      };
    }

    const [dinasAktifRes, totalRes, investigasiRes, waitingRes, repostedRes] =
      await Promise.all([
        this.db.query<{ c: number }>(
          `SELECT COUNT(DISTINCT dinas_inisiasi)::int AS c FROM rdt.transactions WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($1)`,
          [ACTIONABLE_STATUSES],
        ),
        this.db.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($1)`,
          [ACTIONABLE_STATUSES],
        ),
        this.db.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE status_konfirmasi = 'NEEDS_INVESTIGATION'`,
        ),
        // Aturan readiness sama seperti ExportService.getWaiting (4a): semua baris unbatched
        // pasangan itu resolved (nol PENDING/DECLINED/NEEDS_REVIEW) DAN minimal 1 baris attachable.
        //
        // BUG NYATA di `rdt/backend`'s dashboard.js (ditemukan lewat real-DB testing, bukan salah
        // request -- diperbaiki di sini, bukan "disederhanakan"): outer WHERE di sana memakai
        // `[...OPEN_STATUSES, 'NEEDS_REVIEW']` yang sama persis dengan param HAVING $2 -- artinya
        // outer WHERE cuma meloloskan baris BLOCKING, jadi di dalam tiap grup COUNT FILTER
        // (blocking)=0 MUSTAHIL tercapai (semua baris yang lolos WHERE otomatis blocking) ->
        // query itu SELALU balikin 0 di produksi, kontradiksi sama komentar aslinya sendiri
        // ("every unbatched row for the pair is resolved... and at least one attachable row
        // exists") dan beda dari ExportService.getWaiting (4a) yang sudah benar. Outer WHERE di
        // sini diperluas ke union BLOCKING+RESOLVED (`ACTIONABLE_STATUSES` dashboard + literal
        // 'NEEDS_REVIEW' -- BUKAN reuse konstanta export 4a, lihat catatan konstanta di atas)
        // supaya HAVING-nya benar-benar bisa match pasangan yang sudah siap.
        this.db.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM (
             SELECT dinas_inisiasi, dinas_target
             FROM rdt.transactions
             WHERE export_batch_id IS NULL AND dinas_target IS NOT NULL
               AND status_konfirmasi = ANY($1)
             GROUP BY dinas_inisiasi, dinas_target
             HAVING COUNT(*) FILTER (WHERE status_konfirmasi = ANY($2)) = 0
                AND COUNT(*) FILTER (WHERE status_konfirmasi = ANY($3)) > 0
           ) waiting_pairs`,
          [
            [...ACTIONABLE_STATUSES, 'NEEDS_REVIEW'],
            [...OPEN_STATUSES, 'NEEDS_REVIEW'],
            RESOLVED_STATUSES,
          ],
        ),
        this.db.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM rdt.transactions WHERE subdoc_id IS NOT NULL`,
        ),
      ]);
    return {
      is_global_view: true,
      dinas_aktif: dinasAktifRes.rows[0].c,
      total_transaksi: totalRes.rows[0].c,
      butuh_investigasi: investigasiRes.rows[0].c,
      waiting_to_repost: waitingRes.rows[0].c,
      reposted: repostedRes.rows[0].c,
    };
  }

  // GET dashboard/per-dinas-rollup -- TAB-only. SEMUA pasangan satu dinas_inisiasi dijumlah jadi
  // satu baris (beda dari buildChainAwareProgress yang per-pasangan). Urut Open DESC ("worst
  // first"), lalu dinas ASC.
  async getPerDinasRollup(): Promise<PerDinasRollupRow[]> {
    const { rows } = await this.db.query<{
      dinas: string;
      total: number;
      confirmed: number;
      open: number;
      declined: number;
    }>(
      `SELECT dinas_inisiasi AS dinas,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status_konfirmasi = ANY($1))::int AS confirmed,
              COUNT(*) FILTER (WHERE status_konfirmasi = 'PENDING')::int AS open,
              COUNT(*) FILTER (WHERE status_konfirmasi = 'DECLINED')::int AS declined
       FROM rdt.transactions
       WHERE dinas_target IS NOT NULL AND status_konfirmasi = ANY($2)
       GROUP BY dinas_inisiasi
       ORDER BY open DESC, dinas_inisiasi ASC`,
      [RESOLVED_STATUSES, ACTIONABLE_STATUSES],
    );
    const dinasList = rows.map((row) => row.dinas);
    const investigasiRes = dinasList.length
      ? await this.db.query<{ dinas: string; c: number }>(
          `SELECT dinas_inisiasi AS dinas, COUNT(*)::int AS c FROM rdt.transactions
           WHERE status_konfirmasi = 'NEEDS_INVESTIGATION' AND dinas_inisiasi = ANY($1)
           GROUP BY dinas_inisiasi`,
          [dinasList],
        )
      : { rows: [] as { dinas: string; c: number }[] };
    const investigasiByDinas: Record<string, number> = {};
    investigasiRes.rows.forEach((row) => {
      investigasiByDinas[row.dinas] = row.c;
    });

    // Status pill -- urutan prioritas PERSIS, port apa adanya:
    //   investigationCount>0 -> 'Butuh Investigasi (N)' (TAB harus tindak lanjut apapun status
    //   pasangan lain di dinas ini); else open>0 -> 'Waiting for confirmation'; else (total>0)
    //   cek subdoc_id IS NULL di antara baris RESOLVED dinas itu -> 0 -> 'Semua reposted', >0 ->
    //   'Waiting to repost'.
    return Promise.all(
      rows.map(async (row) => {
        const total = row.total;
        const percent =
          total > 0 ? Math.round((row.confirmed / total) * 1000) / 10 : 0;
        const investigationCount = investigasiByDinas[row.dinas] || 0;
        let status: { kind: string; label: string } | null = null;
        if (investigationCount > 0) {
          status = {
            kind: 'investigation',
            label: `Butuh Investigasi (${investigationCount})`,
          };
        } else if (row.open > 0) {
          status = { kind: 'pending', label: 'Waiting for confirmation' };
        } else if (total > 0) {
          const unrepostedRes = await this.db.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c FROM rdt.transactions
             WHERE dinas_inisiasi = $1 AND status_konfirmasi = ANY($2) AND subdoc_id IS NULL`,
            [row.dinas, RESOLVED_STATUSES],
          );
          status =
            unrepostedRes.rows[0].c === 0
              ? { kind: 'reposted', label: 'Semua reposted' }
              : { kind: 'waiting-repost', label: 'Waiting to repost' };
        }
        return {
          dinas: row.dinas,
          total,
          confirmed: row.confirmed,
          open: row.open,
          declined: row.declined,
          percent,
          status,
        };
      }),
    );
  }

  // GET dashboard/summary/:dinasInisiasi/breakdown -- TAB-only. Full reuse
  // buildChainAwareProgress(groupBy:'pair') lalu FILTER ke dinas ini saja -- WAJIB, karena
  // buildChainAwareProgress's groupBy:'pair' branch fetch investigation GLOBAL (lihat komentar
  // di method itu), tanpa filter ini pseudo-card dinas lain bocor ke breakdown dinas ini.
  async getBreakdown(dinasInisiasi: string): Promise<DashboardProgressCard[]> {
    const pairs = await this.buildChainAwareProgress({
      initiatorDinas: dinasInisiasi,
      groupBy: 'pair',
    });
    return pairs.filter(
      (r) => String(r.dinas).toUpperCase() === dinasInisiasi.toUpperCase(),
    );
  }

  // groupBy: 'target' -- mengelompokkan tiap transaksi di bawah dinas target ORIGINAL-nya (dinas
  // pertama yang pernah dituju, chainMap[t.id][0], fallback ke dinas_target sekarang kalau tak
  // pernah di-redirect) -- dipakai view personal as_initiator (satu initiatorDinas tetap, jadi
  // grouping by target saja sudah berarti "satu kartu per pasangan"). 'pair' mengelompokkan
  // (dinas_inisiasi, target original) -- dipakai view global TAB (banyak inisiator, grouping by
  // inisiator saja akan menyembunyikan target mana yang masih outstanding).
  //
  // Sebuah transaksi yang di-reassign menambah HANYA kartu target ORIGINAL-nya, bukan tiap target
  // redirect antara sebagai kartu terpisah -- reassign tak boleh memecah kartu/thread komentar
  // dari tempat diskusi sudah berlangsung. Percent/resolved tetap refleksikan status transaksi
  // SEKARANG, jadi kartu original tetap benar mencapai 100% begitu resolved di target baru.
  private async buildChainAwareProgress(args: {
    initiatorDinas: string | null;
    groupBy: 'pair' | 'target';
  }): Promise<DashboardProgressCard[]> {
    const { initiatorDinas, groupBy } = args;
    const whereParts = [
      'dinas_target IS NOT NULL',
      'status_konfirmasi = ANY($1)',
    ];
    const params: unknown[] = [ACTIONABLE_STATUSES];
    if (initiatorDinas) {
      whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
      params.push(initiatorDinas);
    }
    const { rows: transactions } = await this.db.query<ActionableTxnRow>(
      `SELECT t.id, t.dinas_inisiasi, t.dinas_target, t.status_konfirmasi, t.reassign_count, t.export_batch_id,
              u.period AS declared_period, t.periode_efektif
       FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE ${whereParts.join(' AND ')}`,
      params,
    );

    const reassignedIds = transactions
      .filter((t) => t.reassign_count > 0)
      .map((t) => Number(t.id));
    const chainMap = await fetchReassignChainMap(this.db, reassignedIds);
    const replyCounts = await fetchReplyCounts(
      this.db,
      transactions.map((t) => Number(t.id)),
    );

    // as_initiator cards di-key oleh target ORIGINAL (pre-redirect), tapi rdt.export_batches
    // di-key oleh target SEKARANG pasangan itu -- satu kartu bisa secara prinsip mencakup lebih
    // dari satu batch kalau sebagian transaksinya ambil jalur redirect beda. Ditrack per kartu
    // (batchIds, pending count, apakah ada resolved yang masih unbatched) supaya label
    // merefleksikan state gabungan yang benar, bukan menebak dari satu key yang mismatch.
    const agg = new Map<string, PairAgg>();
    for (const t of transactions) {
      const id = Number(t.id);
      const replyCount = replyCounts[id] || 0;
      const chain = chainMap[id] || [];
      const originalTarget = chain.length > 0 ? chain[0] : t.dinas_target;
      const key =
        groupBy === 'pair'
          ? `${t.dinas_inisiasi} ${originalTarget}`
          : originalTarget;
      // Breadcrumb penuh transaksi INI SATU: inisiator -> tiap dinas antara yang pernah
      // di-reassign-DARI (kronologis) -> dinas_target sekarang.
      const fullChain = [t.dinas_inisiasi, ...chain, t.dinas_target];

      let a = agg.get(key);
      if (!a) {
        a = {
          dinasInisiasi: t.dinas_inisiasi,
          target: originalTarget,
          total: 0,
          resolved: 0,
          pending: 0,
          declinedPendingAction: 0,
          replyCount: 0,
          batchIds: new Set(),
          hasUnbatchedResolved: false,
          chain: fullChain,
          chainConsistent: true,
          periodCounts: {},
          maxPeriodeEfektif: null,
        };
        agg.set(key, a);
      }
      const resolved = RESOLVED_STATUSES.includes(t.status_konfirmasi);
      a.total += 1;
      if (resolved) a.resolved += 1;
      if (t.status_konfirmasi === 'PENDING') a.pending += 1;
      if (t.status_konfirmasi === 'DECLINED') a.declinedPendingAction += 1;
      a.replyCount += replyCount;
      if (resolved) {
        if (t.export_batch_id) a.batchIds.add(Number(t.export_batch_id));
        else a.hasUnbatchedResolved = true;
      }
      if (t.declared_period) {
        a.periodCounts[t.declared_period] =
          (a.periodCounts[t.declared_period] || 0) + 1;
      }
      if (
        t.periode_efektif &&
        (!a.maxPeriodeEfektif || t.periode_efektif > a.maxPeriodeEfektif)
      ) {
        a.maxPeriodeEfektif = t.periode_efektif;
      }
      // Satu kartu bisa mencakup transaksi yang ambil jalur redirect BEDA setelah berbagi target
      // original yang sama -- hanya expose `chain` tunggal kalau SEMUA anggota kartu sepakat
      // jalur yang persis sama.
      if (JSON.stringify(fullChain) !== JSON.stringify(a.chain))
        a.chainConsistent = false;
    }

    // Satu lookup batched buat subdoc number tiap kartu -- kartu yang transaksinya landing di
    // lebih dari satu batch (kasus redirect-split) menampilkan UNION subdoc number semuanya.
    const allBatchIds = Array.from(
      new Set(Array.from(agg.values()).flatMap((a) => Array.from(a.batchIds))),
    );
    const subdocsByBatch = new Map<number, string[]>();
    if (allBatchIds.length) {
      const { rows: subdocRows } = await this.db.query<{
        batch_id: number;
        subdoc_number: string;
      }>(
        `SELECT batch_id, subdoc_number FROM rdt.export_subdocs WHERE batch_id = ANY($1) ORDER BY created_at ASC, id ASC`,
        [allBatchIds],
      );
      for (const s of subdocRows) {
        const batchId = Number(s.batch_id);
        const list = subdocsByBatch.get(batchId) ?? [];
        list.push(s.subdoc_number);
        subdocsByBatch.set(batchId, list);
      }
    }

    // Pasangan yang 100% ter-repost harus hilang ke Riwayat Repost, bukan nongkrong di sini
    // selamanya dengan state_label "Reposted by TAB with subdoc ...". Tak bisa difilter via WHERE
    // export_batch_id IS NULL di query di atas -- hasUnbatchedResolved/batchIds tracking di atas
    // SENGAJA perlu LIHAT baris yang sudah dibatch juga, supaya kartu yang baru SEBAGIAN
    // ter-repost (sebagian ter-subdoc lewat subdoc lama, sebagian baru resolved & belum ter-batch
    // -- alur multi-subdoc-over-time 4c) tetap tampil. Jadi filter di sini, SETELAH agregasi: buang
    // key hanya kalau sudah 100% resolved DAN semua baris resolved sudah ter-batch (benar-benar
    // selesai, tak ada lagi yang bisa di-repost) -- kartu yang masih sebagian tetap tampil apa
    // adanya.
    const keys = Array.from(agg.keys()).filter((key) => {
      const a = agg.get(key)!;
      return !(
        a.total > 0 &&
        a.total === a.resolved &&
        !a.hasUnbatchedResolved &&
        a.batchIds.size > 0
      );
    });
    keys.sort();

    const rows: DashboardProgressCard[] = keys.map((key) => {
      const a = agg.get(key)!;
      const subdocNumbers = a.hasUnbatchedResolved
        ? []
        : Array.from(a.batchIds).flatMap((id) => subdocsByBatch.get(id) ?? []);
      const declaredPeriod = majorityPeriod(a.periodCounts);
      const overdue = !!(
        declaredPeriod &&
        a.maxPeriodeEfektif &&
        a.maxPeriodeEfektif !== declaredPeriod
      );
      const base = {
        total: a.total,
        resolved: a.resolved,
        // Progress bar tersegmentasi butuh PENDING ("Open") sebagai hitungan sendiri, bukan cuma
        // dilipat ke `percent` -- `resolved` sudah menggabung CONFIRMED+BORNE_BY_INITIATOR.
        open: a.pending,
        percent:
          a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
        declined_pending_action: a.declinedPendingAction,
        reply_count: a.replyCount,
        state_label: deriveStateLabel({
          pendingCount: a.pending,
          targetDinas: a.target,
          subdocNumbers,
        }),
        // Breadcrumb redirect penuh (mis. ['TJ','TC','TL']), hanya ada kalau semua transaksi di
        // kartu ini sepakat jalur yang sama.
        chain: a.chainConsistent ? a.chain : undefined,
        // Tag merah kecil "Overdue" di kartu pasangan ini.
        overdue,
      };
      return groupBy === 'pair'
        ? { dinas: a.dinasInisiasi, target_dinas: a.target, ...base }
        : { dinas: a.target, ...base };
    });

    // Lihat header comment fetchInvestigationCounts.
    const investigationRows = await fetchInvestigationCounts(
      this.db,
      groupBy === 'pair' ? null : initiatorDinas,
    );
    if (groupBy === 'pair') {
      rows.push(...investigationRows);
    } else if (investigationRows.length) {
      const r = investigationRows[0];
      rows.push({
        dinas: 'INVESTIGATION',
        total: r.total,
        resolved: 0,
        percent: 0,
        declined_pending_action: 0,
        reply_count: r.reply_count,
      });
    }
    return rows;
  }

  // Beda dari buildChainAwareProgress: grouping by dinas_target SEKARANG (bukan original), scope
  // export_batch_id IS NULL. chain ditampilkan kalau semua member sepakat DAN chain.length>2
  // (beda dari buildChainAwareProgress yang tanpa syarat panjang).
  private async buildNeedToConfirmProgress(
    targetDinasCodes: string[],
    includeInvestigation: boolean,
  ): Promise<DashboardProgressCard[]> {
    const { rows: transactions } = await this.db.query<ActionableTxnRow>(
      `SELECT t.id, t.dinas_inisiasi, t.dinas_target, t.status_konfirmasi, t.reassign_count,
              u.period AS declared_period, t.periode_efektif
       FROM rdt.transactions t
       JOIN rdt.uploads u ON u.id = t.upload_id
       WHERE UPPER(t.dinas_target) = ANY($1)
         AND t.status_konfirmasi = ANY($2)
         AND t.export_batch_id IS NULL`,
      [targetDinasCodes, ACTIONABLE_STATUSES],
    );
    const replyCounts = await fetchReplyCounts(
      this.db,
      transactions.map((t) => Number(t.id)),
    );
    const reassignedIds = transactions
      .filter((t) => t.reassign_count > 0)
      .map((t) => Number(t.id));
    const chainMap = await fetchReassignChainMap(this.db, reassignedIds);

    interface NeedAgg {
      dinas: string;
      targetDinas: string;
      total: number;
      resolved: number;
      pending: number;
      declined: number;
      replyCount: number;
      chain?: string[];
      chainConsistent: boolean;
      chainSeeded: boolean;
      periodCounts: Record<string, number>;
      maxPeriodeEfektif: string | null;
    }
    const agg = new Map<string, NeedAgg>();
    for (const t of transactions) {
      const id = Number(t.id);
      const key = `${t.dinas_inisiasi} ${t.dinas_target}`;
      let a = agg.get(key);
      if (!a) {
        a = {
          dinas: t.dinas_inisiasi,
          targetDinas: t.dinas_target,
          total: 0,
          resolved: 0,
          pending: 0,
          declined: 0,
          replyCount: 0,
          chain: undefined,
          chainConsistent: true,
          chainSeeded: false,
          periodCounts: {},
          maxPeriodeEfektif: null,
        };
        agg.set(key, a);
      }
      a.total += 1;
      if (RESOLVED_STATUSES.includes(t.status_konfirmasi)) a.resolved += 1;
      if (t.status_konfirmasi === 'PENDING') a.pending += 1;
      if (t.status_konfirmasi === 'DECLINED') a.declined += 1;
      a.replyCount += replyCounts[id] || 0;
      if (t.declared_period) {
        a.periodCounts[t.declared_period] =
          (a.periodCounts[t.declared_period] || 0) + 1;
      }
      if (
        t.periode_efektif &&
        (!a.maxPeriodeEfektif || t.periode_efektif > a.maxPeriodeEfektif)
      ) {
        a.maxPeriodeEfektif = t.periode_efektif;
      }
      const fullChain = [
        t.dinas_inisiasi,
        ...(chainMap[id] || []),
        t.dinas_target,
      ];
      if (!a.chainSeeded) {
        a.chain = fullChain;
        a.chainSeeded = true;
      } else if (JSON.stringify(fullChain) !== JSON.stringify(a.chain)) {
        a.chainConsistent = false;
      }
    }

    const keys = Array.from(agg.keys()).sort();
    const rows: DashboardProgressCard[] = keys.map((key) => {
      const a = agg.get(key)!;
      const declaredPeriod = majorityPeriod(a.periodCounts);
      const overdue = !!(
        declaredPeriod &&
        a.maxPeriodeEfektif &&
        a.maxPeriodeEfektif !== declaredPeriod
      );
      return {
        dinas: a.dinas,
        target_dinas: a.targetDinas,
        total: a.total,
        resolved: a.resolved,
        open: a.pending,
        declined_pending_action: a.declined,
        percent:
          a.total > 0 ? Math.round((a.resolved / a.total) * 1000) / 10 : 0,
        reply_count: a.replyCount,
        state_label: deriveStateLabel({
          pendingCount: a.pending,
          targetDinas: a.targetDinas,
        }),
        chain:
          a.chainConsistent && a.chain && a.chain.length > 2
            ? a.chain
            : undefined,
        overdue,
      };
    });
    if (includeInvestigation) {
      rows.push(...(await fetchInvestigationCounts(this.db, null)));
    }
    return rows;
  }

  // TAB juga staf antrian dinas 'Corp' (tak punya PIC sendiri). 'TA' TIDAK termasuk -- dinas
  // operasional sendiri dengan PIC sendiri, beda dari staf TAB.
  private needToConfirmTargetCodes(
    myDinas: string,
    isTabStaff: boolean,
  ): string[] {
    return (isTabStaff ? [myDinas, 'Corp'] : [myDinas]).map((d) =>
      d.toUpperCase(),
    );
  }

  // Daftar kode dinas bare, tanpa agregasi percent/reply-count -- HANYA dipakai
  // getNeedToConfirmCount (badge sidebar, dipanggil tiap page load) supaya tetap satu query
  // DISTINCT murah, tak perlu bayar join reply-count per-transaksi buildNeedToConfirmProgress.
  private async fetchNeedToConfirmDinas(
    targetDinasCodes: string[],
    includeInvestigation: boolean,
  ): Promise<string[]> {
    const { rows } = await this.db.query<{ dinas: string }>(
      `SELECT DISTINCT t.dinas_inisiasi AS dinas
       FROM rdt.transactions t
       WHERE UPPER(t.dinas_target) = ANY($1)
         AND t.status_konfirmasi = ANY($2)
         AND t.export_batch_id IS NULL
       ORDER BY dinas`,
      [targetDinasCodes, ACTIONABLE_STATUSES],
    );
    const dinasList = rows.map((r) => r.dinas);
    if (includeInvestigation) {
      const { rows: invRows } = await this.db.query(
        `SELECT 1 FROM rdt.transactions WHERE status_konfirmasi='NEEDS_INVESTIGATION' LIMIT 1`,
      );
      if (invRows.length) dinasList.push('INVESTIGATION');
    }
    return dinasList;
  }
}
