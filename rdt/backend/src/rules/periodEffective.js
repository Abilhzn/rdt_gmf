// REQ-RDT-SAP-14 (REVISI TOTAL 5 Agu): deadline per (dinas_inisiasi, dinas_target, periode) --
// mengikat kapan DINAS TARGET melakukan aksi Confirm/Reject untuk pasangan itu, BUKAN kapan TAB
// repost. Pure function, sama pola dengan rules/stateLabel.js/reassignmentRules.js -- caller
// (routes/exportBatches.js) yang query DB, ini cuma logic murni supaya unit-testable tanpa DB.
//
// "latestTargetActionAt" HARUS diambil dari rdt.audit_log (MAX(created_at) per transaction_id
// WHERE action IN ('CONFIRM','DECLINE')), BUKAN dari transactions.decided_at -- decided_at
// ke-OVERWRITE begitu baris DECLINED itu belakangan jadi BORNE_BY_INITIATOR (timestamp keputusan
// INITIATOR nimpa timestamp REJECT asli dinas target). audit_log insert-only, jadi tetap akurat
// walau baris itu berubah status lagi setelahnya. Baris yang di-reassign di tengah jalan otomatis
// cuma nyumbang entry CONFIRM/DECLINE dari target-nya yang SEKARANG (yang paling akhir), jadi
// tidak perlu logic chain-walking terpisah di sini.

// Menambah N bulan ke string periode 'YYYY-MM', wrap tahun kalau perlu.
function addMonths(periode, n) {
  const [yyyy, mm] = periode.split('-').map(Number);
  const zeroBased = mm - 1 + n;
  const year = yyyy + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12; // safe untuk n negatif juga, walau belum dipakai
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// computeEffectivePeriod({ declaredPeriod, deadlineAt, latestTargetActionAt })
//   -> { periodeEfektif, overdue }
//
// declaredPeriod: 'YYYY-MM', periode data yang dinyatakan dinas pengaju saat Repost (REQ-RDT-SAP-13).
// deadlineAt: Date | string | null -- deadline_at dari rdt.period_deadlines untuk pasangan+periode
//   ini, atau null/undefined kalau TAB belum pernah set (opt-in, poin 5 -- default aman).
// latestTargetActionAt: Date | string | null -- MAX(audit_log.created_at) dinas target untuk
//   pasangan ini (lihat komentar di atas kenapa BUKAN transactions.decided_at), atau null kalau
//   pasangan belum sepenuhnya resolved (seharusnya tidak pernah dipanggil dalam kondisi ini --
//   dijaga defensif saja).
function computeEffectivePeriod({ declaredPeriod, deadlineAt, latestTargetActionAt }) {
  if (!deadlineAt || !latestTargetActionAt) {
    return { periodeEfektif: declaredPeriod, overdue: false };
  }
  const deadline = deadlineAt instanceof Date ? deadlineAt : new Date(deadlineAt);
  const actedAt = latestTargetActionAt instanceof Date ? latestTargetActionAt : new Date(latestTargetActionAt);
  if (actedAt.getTime() <= deadline.getTime()) {
    return { periodeEfektif: declaredPeriod, overdue: false };
  }
  return { periodeEfektif: addMonths(declaredPeriod, 1), overdue: true };
}

// REQ-RDT-SAP-16 (8 Agu): snapshotPeriodeEfektif's deadline lookup order — a per-pasangan
// override in rdt.period_deadlines (REQ-RDT-SAP-14) always wins when it exists (TAB explicitly
// set it for THIS pair, more specific than a periode-wide default); rdt.period_default_deadlines
// (set in advance, before any pair for that periode even exists) is only a fallback; neither
// existing means no deadline check at all (opt-in, same as before this requirement). Pure
// function — caller does both queries, this just picks between the two rows.
function pickDeadline(pairDeadlineRow, defaultDeadlineRow) {
  if (pairDeadlineRow && pairDeadlineRow.deadline_at) return pairDeadlineRow.deadline_at;
  if (defaultDeadlineRow && defaultDeadlineRow.deadline_at) return defaultDeadlineRow.deadline_at;
  return null;
}

module.exports = { computeEffectivePeriod, addMonths, pickDeadline };
