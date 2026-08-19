// Duplicate transaction detection, scoped to CROSS-UPLOAD matches only (not within-file/batch):
// a strict natural key can legitimately repeat within one verified file (e.g. a partial-quantity
// split across two rows), so within-file matches are not duplicates. This only flags the real
// failure mode: a dinas re-uploading the same month, or two uploads with an overlapping period.

function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function naturalKeyOf(row) {
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

// existingRows: array of {id, upload_id, document_no, ref_doc, account, cost_ctr, profit_ctr, item, in_pclc, dinas_target}
// Returns a Map from natural key -> existing row (first match wins).
function buildExistingKeyIndex(existingRows) {
  const index = new Map();
  for (const r of existingRows) {
    const key = naturalKeyOf(r);
    if (!index.has(key)) index.set(key, r);
  }
  return index;
}

// Mutates nothing; returns a new array of rows where any PENDING row matching an existing
// natural key is downgraded to NEEDS_REVIEW with a reason referencing the earlier transaction.
// Rows already EXCLUDED/INVALID/NEEDS_REVIEW are left untouched (dup check only applies to
// rows that would otherwise enter the cross-dinas confirmation workflow as PENDING).
function flagDuplicates(rows, existingRows) {
  const existingIndex = buildExistingKeyIndex(existingRows);
  return rows.map((row) => {
    if (row.status_konfirmasi !== 'PENDING') return row;
    const match = existingIndex.get(naturalKeyOf(row));
    if (!match) return row;
    return Object.assign({}, row, {
      status_konfirmasi: 'NEEDS_REVIEW',
      reason_if_invalid: `Kemungkinan duplikat transaksi (cocok dengan transaction id=${match.id}, upload id=${match.upload_id})`,
    });
  });
}

module.exports = {
  naturalKeyOf,
  buildExistingKeyIndex,
  flagDuplicates,
};
