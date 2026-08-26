// Konstanta KHUSUS dashboard (Batch 5b) — port apa adanya dari `routes/dashboard.js`. JANGAN
// reuse BLOCKING_STATUSES/ATTACHABLE_STATUSES dari `repost/export` (4a) — beda semantik meski
// RESOLVED_STATUSES kebetulan sama isinya dengan ATTACHABLE_STATUSES di sana.

// DECLINED sengaja BUKAN resolved: tanggung jawab baris declined masih di dinas yang di-mention
// sampai jadi CONFIRMED/BORNE_BY_INITIATOR, atau di-reassign (balik jadi PENDING dinas_target
// baru) — menghitungnya "resolved" di sini bikin percent bisa 100% padahal
// declined_pending_action masih >0, state UI yang kontradiktif.
export const RESOLVED_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR'];
export const ACTIONABLE_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'BORNE_BY_INITIATOR',
];
// "Open" = masih butuh keputusan SIAPA PUN (PENDING nunggu target, DECLINED nunggu inisiator
// Tanggung Sendiri/Ajukan Ulang) — komplemen RESOLVED_STATUSES di dalam ACTIONABLE_STATUSES.
export const OPEN_STATUSES = ['PENDING', 'DECLINED'];
