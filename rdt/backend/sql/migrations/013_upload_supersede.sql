-- REQ-RDT-EXT-10 (4 Agu): POST /api/persist never invalidated a dinas's previous upload for the
-- same (dinas_inisiasi, periode) before inserting a new one -- fully additive, so a re-posted
-- period accumulated forever and got double-counted by every dashboard/queue aggregation that
-- wasn't scoped to a single upload_id. Old uploads are marked SUPERSEDED (never deleted -- audit
-- trail stays intact), not dropped.

ALTER TABLE rdt.uploads
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUPERSEDED')),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_upload_id bigint REFERENCES rdt.uploads(id);

-- Whether a superseded upload's transaction rows may be auto-touched is decided by a FACT (does
-- rdt.ledger_entries have a row for it -- i.e. has money actually moved) rather than a guessed
-- status whitelist (project owner correction, 4 Agu) -- see persist/supersedeCheck.js. Rows that
-- clear that check get flipped to this new terminal status, which (like SPLIT_VOID before it) is
-- deliberately absent from every existing status whitelist in dashboard.js/exportBatches.js/
-- confirmation.js/investigation.js, so they disappear from active aggregation with zero query
-- changes needed in those files.
ALTER TABLE rdt.transactions DROP CONSTRAINT IF EXISTS transactions_status_konfirmasi_check;
ALTER TABLE rdt.transactions
  ADD CONSTRAINT transactions_status_konfirmasi_check
  CHECK (status_konfirmasi IN (
    'PENDING',
    'CONFIRMED',
    'DECLINED',
    'BORNE_BY_INITIATOR',
    'EXCLUDED',
    'INVALID',
    'NEEDS_REVIEW',
    'NEEDS_INVESTIGATION',
    'SPLIT_VOID',
    'SUPERSEDED'
  ));
