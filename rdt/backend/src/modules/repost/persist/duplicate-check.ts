// Duplicate transaction detection, scoped to CROSS-UPLOAD matches only (not within-file/batch):
// a strict natural key can legitimately repeat within one verified file (e.g. a partial-quantity
// split across two rows), so within-file matches are not duplicates. This only flags the real
// failure mode: a dinas re-uploading the same month, or two uploads with an overlapping period.
//
// Port 1:1 dari backend/src/persist/duplicateCheck.js. CATATAN: parser Format CBO tidak
// menghasilkan document_no, jadi fungsi ini praktis inert di alur sekarang -- di-port apa
// adanya, bukan diubah ke kunci dedup lain (mis. ref_doc); itu keputusan produk terpisah.

import { RowStatus } from '../../../core/enums/row-status.enum';

export interface DuplicateCheckRow {
  document_no?: unknown;
  ref_doc?: unknown;
  account?: unknown;
  cost_ctr?: unknown;
  profit_ctr?: unknown;
  item?: unknown;
  in_pclc?: unknown;
  dinas_target?: unknown;
  status_konfirmasi: RowStatus;
  reason_if_invalid?: string | null;
}

export interface ExistingTransactionRow {
  id: number;
  upload_id: number;
  document_no?: unknown;
  ref_doc?: unknown;
  account?: unknown;
  cost_ctr?: unknown;
  profit_ctr?: unknown;
  item?: unknown;
  in_pclc?: unknown;
  dinas_target?: unknown;
}

function normalize(v: unknown): string {
  if (v === null || v === undefined) return '';
  // port apa adanya dari JS lama: field-field ini selalu primitive di praktiknya, String(v)
  // match perilaku aslinya persis.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v).trim();
}

export function naturalKeyOf(
  row: DuplicateCheckRow | ExistingTransactionRow,
): string {
  return [
    normalize(row.document_no),
    normalize(row.ref_doc),
    normalize(row.account),
    normalize(row.cost_ctr),
    normalize(row.profit_ctr),
    normalize(row.item),
    normalize(row.in_pclc),
    normalize(row.dinas_target),
  ].join('|');
}

// Returns a Map dari natural key -> existing row (match pertama menang).
export function buildExistingKeyIndex(
  existingRows: ExistingTransactionRow[],
): Map<string, ExistingTransactionRow> {
  const index = new Map<string, ExistingTransactionRow>();
  for (const r of existingRows) {
    const key = naturalKeyOf(r);
    if (!index.has(key)) index.set(key, r);
  }
  return index;
}

// Tidak memutasi apa pun; mengembalikan array baru di mana baris PENDING yang cocok natural
// key existing di-downgrade jadi NEEDS_REVIEW + reason. Baris EXCLUDED/INVALID/NEEDS_REVIEW
// dibiarkan (dup check hanya berlaku untuk baris yang akan masuk alur konfirmasi cross-dinas
// sebagai PENDING).
export function flagDuplicates<T extends DuplicateCheckRow>(
  rows: T[],
  existingRows: ExistingTransactionRow[],
): T[] {
  const existingIndex = buildExistingKeyIndex(existingRows);
  return rows.map((row) => {
    if (row.status_konfirmasi !== RowStatus.PENDING) return row;
    const match = existingIndex.get(naturalKeyOf(row));
    if (!match) return row;
    return Object.assign({}, row, {
      status_konfirmasi: RowStatus.NEEDS_REVIEW,
      reason_if_invalid: `Kemungkinan duplikat transaksi (cocok dengan transaction id=${match.id}, upload id=${match.upload_id})`,
    });
  });
}
