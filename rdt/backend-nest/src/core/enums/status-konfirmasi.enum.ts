/**
 * `rdt.transactions.status_konfirmasi` — state machine approve/reject/reassign (Batch 3),
 * persis daftar CHECK constraint di sql/schema.sql.
 */
export enum StatusKonfirmasi {
  PENDING = 'PENDING', // menunggu klaim dinas target
  CONFIRMED = 'CONFIRMED', // dinas target: "ya, milik kami"
  DECLINED = 'DECLINED', // dinas target: "bukan milik kami"
  BORNE_BY_INITIATOR = 'BORNE_BY_INITIATOR', // declined, ditanggung dinas pengaju
  EXCLUDED = 'EXCLUDED', // internal/AUAK/PO — bukan tagihan lintas dinas
  INVALID = 'INVALID', // gagal validasi parser
  NEEDS_REVIEW = 'NEEDS_REVIEW', // prefix tak dikenal, perlu keputusan manual
}
