-- REQ-RDT-LEDGER-10 (27 Jul 2026, temuan makna "Ask TA"): "Ask TA" is not a dinas — it's a
-- signal that a row's ownership is ambiguous from the data alone and needs manual TAB
-- investigation before a real dinas_target can be assigned. New status NEEDS_INVESTIGATION
-- added below. Runs on every server start (no migration-tracking table in this project, see
-- migrate.js) — every statement here must be idempotent.

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
    'NEEDS_INVESTIGATION'
  ));

-- reassigned_from previously FK-referenced rdt.dinas(code). The new TAB "assign" action
-- (routes/investigation.js, action INVESTIGATION_RESOLVED) needs to record the literal sentinel
-- 'Ask TA' here so the audit trail shows where the row came from — but 'Ask TA' is deliberately
-- NOT a row in rdt.dinas (same reasoning as TAB's own exclusion), so it can never satisfy this
-- FK. This is the same class of bug as the TA/TAB transactions_dinas_target_fkey violation found
-- live 28 Jul — a non-dinas signal string can never satisfy a dinas FK. Drop the FK so this
-- column can hold either a real dinas code (existing REASSIGN/REJECT_REDIRECT paths, unchanged)
-- or the 'Ask TA' sentinel (new INVESTIGATION_RESOLVED path).
ALTER TABLE rdt.transactions DROP CONSTRAINT IF EXISTS transactions_reassigned_from_fkey;
