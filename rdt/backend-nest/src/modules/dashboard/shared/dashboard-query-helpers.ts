// Helper query bersama dashboard (Batch 5b) — DIPAKAI LAGI di 5c (Dashboard-Detailing), jangan
// taruh privat di satu service. Port apa adanya dari `routes/dashboard.js`'s
// fetchReassignChainMap/fetchReplyCounts/fetchInvestigationCounts.
//
// Fungsi murni-query: tak butuh dependency di-inject (tak ada logic selain SQL + reshape), jadi
// plain function (bukan @Injectable class) yang menerima `db`/`client` apa saja yang punya
// `.query()` -- DatabaseService (baca-saja, di luar transaksi) MAUPUN PoolClient (di dalam
// `withTransaction`, dipakai 5c nanti).

export interface QueryExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

// Dipakai buildChainAwareProgress (groupBy:'target') DAN getPairTransactions (5c) — dua-duanya
// butuh "dinas mana saja yang pernah dilewati transaksi ini sebelum landing di target sekarang".
// Map: transactionId -> [from_dinas, from_dinas, ...] urut kronologis, dedup berurutan.
export async function fetchReassignChainMap(
  db: QueryExecutor,
  transactionIds: number[],
): Promise<Record<number, string[]>> {
  if (!transactionIds.length) return {};
  const { rows } = await db.query<{
    transaction_id: number;
    detail: { from_dinas?: string } | null;
  }>(
    `SELECT transaction_id, detail FROM rdt.audit_log
     WHERE transaction_id = ANY($1) AND action IN ('REASSIGN', 'REJECT_REDIRECT')
     ORDER BY transaction_id, id ASC`,
    [transactionIds],
  );
  const chainMap: Record<number, string[]> = {};
  for (const row of rows) {
    const fromDinas = row.detail?.from_dinas;
    if (!fromDinas) continue;
    const id = Number(row.transaction_id);
    if (!chainMap[id]) chainMap[id] = [];
    if (!chainMap[id].includes(fromDinas)) chainMap[id].push(fromDinas);
  }
  return chainMap;
}

// Satu query batched per call site (bukan per-transaksi) buat "N reply" di tiap kartu dashboard.
export async function fetchReplyCounts(
  db: QueryExecutor,
  transactionIds: number[],
): Promise<Record<number, number>> {
  if (!transactionIds.length) return {};
  const { rows } = await db.query<{ transaction_id: number; c: number }>(
    `SELECT transaction_id, COUNT(*)::int AS c FROM rdt.comments WHERE transaction_id = ANY($1) GROUP BY transaction_id`,
    [transactionIds],
  );
  const map: Record<number, number> = {};
  rows.forEach((r) => {
    map[Number(r.transaction_id)] = r.c;
  });
  return map;
}

// Baris NEEDS_INVESTIGATION (dinas_target NULL) tak pernah muncul di query per-pasangan manapun
// -- disurface sebagai pseudo-card sentinel `target_dinas:'INVESTIGATION'` (tak pernah nabrak
// kode dinas asli). percent selalu 0 -- per definisi belum ada yang "resolved" selagi masih
// nunggu investigasi TAB.
export interface InvestigationPseudoCard {
  dinas: string;
  target_dinas: 'INVESTIGATION';
  total: number;
  resolved: 0;
  percent: 0;
  declined_pending_action: 0;
  reply_count: number;
}

export async function fetchInvestigationCounts(
  db: QueryExecutor,
  initiatorDinas: string | null,
): Promise<InvestigationPseudoCard[]> {
  const whereParts = [`status_konfirmasi = 'NEEDS_INVESTIGATION'`];
  const params: unknown[] = [];
  if (initiatorDinas) {
    whereParts.push(`dinas_inisiasi = $${params.length + 1}`);
    params.push(initiatorDinas);
  }
  const { rows } = await db.query<{ id: number; dinas_inisiasi: string }>(
    `SELECT id, dinas_inisiasi FROM rdt.transactions WHERE ${whereParts.join(' AND ')}`,
    params,
  );
  const replyCounts = await fetchReplyCounts(
    db,
    rows.map((r) => Number(r.id)),
  );
  const byDinas: Record<string, { total: number; reply_count: number }> = {};
  for (const row of rows) {
    if (!byDinas[row.dinas_inisiasi]) {
      byDinas[row.dinas_inisiasi] = { total: 0, reply_count: 0 };
    }
    byDinas[row.dinas_inisiasi].total += 1;
    byDinas[row.dinas_inisiasi].reply_count += replyCounts[Number(row.id)] || 0;
  }
  return Object.keys(byDinas)
    .sort()
    .map((dinas) => ({
      dinas,
      target_dinas: 'INVESTIGATION' as const,
      total: byDinas[dinas].total,
      resolved: 0 as const,
      percent: 0 as const,
      declined_pending_action: 0 as const,
      reply_count: byDinas[dinas].reply_count,
    }));
}
