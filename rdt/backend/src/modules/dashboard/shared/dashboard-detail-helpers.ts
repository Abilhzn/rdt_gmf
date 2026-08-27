// Helper khusus Dashboard-Detailing + comment thread (Batch 5c) -- nama beda dari
// `dashboard-query-helpers.ts` (5b) biar jelas beda scope, walau `getPairTransactions` di sini
// reuse `fetchReassignChainMap` (5b) untuk resolusi chain per-transaksi.

import type { Identity } from '../../../core/security/identity.interface';
import type { EmployeeDirectory } from '../../../core/directory/directory.interface';
import { ACTIONABLE_STATUSES } from '../dashboard.constants';
import {
  fetchReassignChainMap,
  QueryExecutor,
} from './dashboard-query-helpers';

// Siapa boleh lihat/posting di drill-down + comment thread satu pasangan dinas -- PIC salah SATU
// sisi pasangan (inisiator ATAU target), atau TAB (lihat semua pasangan).
export function canAccessPair(
  user: Identity,
  initiatorDinas: string,
  targetDinas: string,
): boolean {
  if (user.role === 'TAB') return true;
  const myDinas = user.dinas.toUpperCase();
  return (
    myDinas === initiatorDinas.toUpperCase() ||
    myDinas === targetDinas.toUpperCase()
  );
}

export interface PairTransactionRow {
  id: number;
  account: unknown;
  nominal: unknown;
  status_konfirmasi: string;
  ref_doc: unknown;
  remark: unknown;
  dinas_target: string | null;
  reassign_count: number;
  // Absen utk baris sentinel INVESTIGATION (dinas_target IS NULL by definition, tak pernah
  // dirutekan) -- port apa adanya, JANGAN dipaksa isi array kosong.
  chain?: string[];
}

// Dashboard-Detailing: setiap transaksi yang diinisiasi `initiatorDinas` yang dinas_target
// SEKARANG-nya `targetDinas`, ATAU yang jalur reassign-nya PERNAH lewat `targetDinas` -- "sekali
// masuk chain, tetap terhitung", prinsip sama `buildChainAwareProgress` (5b), supaya daftar
// transaksi dan percent-nya konsisten satu sama lain.
export async function getPairTransactions(
  db: QueryExecutor,
  initiatorDinas: string,
  targetDinas: string,
): Promise<PairTransactionRow[]> {
  // Sentinel 'INVESTIGATION' tak punya dinas_target asli buat di-chain-resolve (baris ini
  // dinas_target IS NULL by definition, masih nunggu TAB assign) -- filter status polos,
  // TANPA chain logic, biar dinas pengaju (dan TAB) bisa lihat di Dashboard-Detailing sebelum
  // baris ini pernah dirutekan ke mana pun.
  if (targetDinas.toUpperCase() === 'INVESTIGATION') {
    const { rows } = await db.query<Omit<PairTransactionRow, 'chain'>>(
      `SELECT id, account, nominal, status_konfirmasi, ref_doc, remark, dinas_target, reassign_count
       FROM rdt.transactions WHERE dinas_inisiasi=$1 AND status_konfirmasi='NEEDS_INVESTIGATION'`,
      [initiatorDinas],
    );
    return rows;
  }

  const { rows: transactions } = await db.query<
    Omit<PairTransactionRow, 'chain'>
  >(
    `SELECT id, account, nominal, status_konfirmasi, ref_doc, remark, dinas_target, reassign_count
     FROM rdt.transactions WHERE dinas_inisiasi=$1 AND dinas_target IS NOT NULL AND status_konfirmasi = ANY($2)`,
    [initiatorDinas, ACTIONABLE_STATUSES],
  );
  const reassignedIds = transactions
    .filter((t) => t.reassign_count > 0)
    .map((t) => Number(t.id));
  const chainMap = await fetchReassignChainMap(db, reassignedIds);
  const targetUpper = targetDinas.toUpperCase();
  return (
    transactions
      .filter((t) => {
        const hops = chainMap[Number(t.id)] || [];
        const chainDinas = new Set(
          [t.dinas_target, ...hops].map((d) => String(d).toUpperCase()),
        );
        return chainDinas.has(targetUpper);
      })
      // Breadcrumb pair-level (buildChainAwareProgress's `chain`, 5b) cuma tampil kalau SEMUA
      // transaksi di pasangan itu sepakat jalur yang sama, yang nyaris tak pernah benar begitu ada
      // satu baris di-redirect -- di sini tiap transaksi bawa `chain` PENUH milik sendiri (inisiator
      // -> tiap hop from_dinas -> target sekarang), biar frontend bisa tampilkan per-baris.
      .map((t) => ({
        ...t,
        chain: [
          initiatorDinas,
          ...(chainMap[Number(t.id)] || []),
          t.dinas_target as string,
        ],
      }))
  );
}

export interface PairComment {
  id: number;
  parent_comment_id: number | null;
  author_user_id: string;
  author_display_name: string;
  body: string;
  created_at: Date | string;
}

// Comment nempel ke SATU baris transaksi (schema: transaction_id NOT NULL), tapi thread halaman
// ini scoped ke satu PASANGAN, bukan satu transaksi -- gabung SEMUA comment lintas setiap
// transaksi pasangan itu urut waktu, biar terbaca sebagai satu percakapan berkelanjutan, apa pun
// baris spesifik yang jadi anchor tiap comment.
export async function getPairCommentThread(
  db: QueryExecutor,
  pairTransactionIds: number[],
  directory: EmployeeDirectory,
): Promise<PairComment[]> {
  if (!pairTransactionIds.length) return [];
  const { rows } = await db.query<{
    id: number;
    transaction_id: number;
    parent_comment_id: number | null;
    author_user_id: string;
    body: string;
    created_at: Date | string;
  }>(
    `SELECT id, transaction_id, parent_comment_id, author_user_id, body, created_at
     FROM rdt.comments WHERE transaction_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [pairTransactionIds],
  );
  return rows.map((c) => ({
    id: Number(c.id),
    parent_comment_id:
      c.parent_comment_id !== null && c.parent_comment_id !== undefined
        ? Number(c.parent_comment_id)
        : null,
    author_user_id: c.author_user_id,
    author_display_name:
      directory[c.author_user_id]?.display_name ?? c.author_user_id,
    body: c.body,
    created_at: c.created_at,
  }));
}
