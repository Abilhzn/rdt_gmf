// Deadline per (dinas_inisiasi, dinas_target, periode) -- mengikat kapan DINAS TARGET melakukan
// aksi Confirm/Reject, BUKAN kapan TAB repost. Pure function; caller (exportBatches.js) queries
// the DB, this just picks the periode.
//
// "latestTargetActionAt" HARUS dari rdt.audit_log (MAX(created_at), action IN ('CONFIRM','DECLINE')),
// BUKAN transactions.decided_at -- decided_at ke-overwrite kalau baris DECLINED belakangan jadi
// BORNE_BY_INITIATOR. audit_log insert-only jadi tetap akurat walau status berubah lagi setelahnya.

// Menambah N bulan ke string periode 'YYYY-MM', wrap tahun kalau perlu.
export function addMonths(periode: string, n: number): string {
  const [yyyy, mm] = periode.split('-').map(Number);
  const zeroBased = mm - 1 + n;
  const year = yyyy + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12; // safe untuk n negatif juga, walau belum dipakai
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export interface ComputeEffectivePeriodInput {
  declaredPeriod: string;
  deadlineAt: string | Date | null | undefined;
  latestTargetActionAt: string | Date | null | undefined;
}

export interface EffectivePeriodResult {
  periodeEfektif: string;
  overdue: boolean;
}

// computeEffectivePeriod({ declaredPeriod, deadlineAt, latestTargetActionAt })
//   -> { periodeEfektif, overdue }
//
// declaredPeriod: 'YYYY-MM', periode data yang dinyatakan dinas pengaju saat Repost.
// deadlineAt: deadline_at dari rdt.period_deadlines, atau null kalau TAB belum pernah set (opt-in).
// latestTargetActionAt: MAX(audit_log.created_at) dinas target (lihat komentar di atas kenapa
//   bukan transactions.decided_at), atau null kalau pasangan belum resolved (dijaga defensif).
export function computeEffectivePeriod({
  declaredPeriod,
  deadlineAt,
  latestTargetActionAt,
}: ComputeEffectivePeriodInput): EffectivePeriodResult {
  if (!deadlineAt || !latestTargetActionAt) {
    return { periodeEfektif: declaredPeriod, overdue: false };
  }
  const deadline =
    deadlineAt instanceof Date ? deadlineAt : new Date(deadlineAt);
  const actedAt =
    latestTargetActionAt instanceof Date
      ? latestTargetActionAt
      : new Date(latestTargetActionAt);
  if (actedAt.getTime() <= deadline.getTime()) {
    return { periodeEfektif: declaredPeriod, overdue: false };
  }
  return { periodeEfektif: addMonths(declaredPeriod, 1), overdue: true };
}

export interface DeadlineRow {
  deadline_at?: string | Date | null;
}

// Deadline lookup order: a per-pasangan override in rdt.period_deadlines always wins when it
// exists (more specific than a periode-wide default); rdt.period_default_deadlines is only a
// fallback; neither existing means no deadline check at all (opt-in).
export function pickDeadline(
  pairDeadlineRow: DeadlineRow | null | undefined,
  defaultDeadlineRow: DeadlineRow | null | undefined,
): string | Date | null {
  if (pairDeadlineRow && pairDeadlineRow.deadline_at)
    return pairDeadlineRow.deadline_at;
  if (defaultDeadlineRow && defaultDeadlineRow.deadline_at)
    return defaultDeadlineRow.deadline_at;
  return null;
}

// Periode DT tidak dipilih manual saat Upload — selalu implisit = bulan SEBELUM bulan upload
// berjalan (server time, bukan client). now: Date, default `new Date()`, parameterized for testability.
export function currentAutoPeriode(now: Date = new Date()): string {
  return addMonths(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    -1,
  );
}
