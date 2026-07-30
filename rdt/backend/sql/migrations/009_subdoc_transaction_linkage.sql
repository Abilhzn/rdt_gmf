-- REQ-RDT-SAP-11 (31 Jul, gap found in code review): rdt.export_subdocs was {batch_id,
-- subdoc_number} only -- no way to tell which transaction rows a given subdoc number actually
-- covers, which matters once a pair's repost gets split into more than one subdoc (SAP's ~300
-- line item cap).
--
-- Column on rdt.transactions, not a junction table: a transaction belongs to AT MOST ONE subdoc
-- (a fixed line-item assignment, never many-to-many), same shape as export_batch_id already uses
-- for the batch<->transactions relationship (schema.sql) -- consistent with that existing
-- pattern rather than introducing a new join table for what's still a plain one-to-many.
--
-- Runs on every server start (no migration-tracking table, see migrate.js) -- every statement
-- here must be idempotent.

ALTER TABLE rdt.transactions ADD COLUMN IF NOT EXISTS subdoc_id bigint REFERENCES rdt.export_subdocs(id);
CREATE INDEX IF NOT EXISTS idx_txn_subdoc ON rdt.transactions (subdoc_id);
