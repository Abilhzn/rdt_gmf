// REQ-RDT-EXT-03 — duplicate transaction detection.
//
// Design note (empirically validated against contoh_input/06. DT TB - Jun 2026.xlsx):
// a strict 7-field natural key (document_no+ref_doc+account+cost_ctr+profit_ctr+item+in_pclc)
// already matches 9 pairs of rows *within that single, already-verified file* — e.g. the same
// document_no/ref_doc posting a partial-quantity split across two consecutive rows with
// identical amounts. Those are legitimate distinct postings already baked into the SRS pivot
// totals that test/parser.test.js asserts against; treating them as duplicates would silently
// diverge from the verified ground truth.
//
// So duplicate detection here is intentionally scoped to CROSS-UPLOAD matches only (does this
// natural key already exist among previously-persisted rdt.transactions rows, from a different
// upload) rather than within-file/within-batch matches. That maps to the real failure mode this
// requirement guards against: a dinas accidentally re-uploading the same month, or two uploads
// covering an overlapping period — not legitimate repeated postings inside one correct file.

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
