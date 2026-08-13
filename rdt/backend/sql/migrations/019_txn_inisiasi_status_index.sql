-- Data-engineering pass (12 Agu): schema.sql's idx_txn_target_status covers "confirm-side"
-- lookups (dinas_target, status_konfirmasi) but rdt.transactions has no equivalent for the
-- "initiator-side" -- and this table's core access pattern IS per-pasangan (dinas_inisiasi,
-- dinas_target), not per-target alone. Queries filtering dinas_inisiasi+status_konfirmasi
-- without this index (dashboard.js's NEEDS_INVESTIGATION/actionable counts, reassignment.js's
-- pending-count) currently fall back to a sequential scan on this table -- the one table in the
-- schema that actually grows every month (real transaction volume), unlike export_batches/
-- comments/notifications which stay small. Mirrors idx_txn_target_status's exact shape so both
-- sides of a pasangan are covered the same way.
--
-- Runs on every server start (no migration-tracking table re-check here -- see migrate.js),
-- so this statement must be idempotent.

CREATE INDEX IF NOT EXISTS idx_txn_inisiasi_status
  ON rdt.transactions (dinas_inisiasi, status_konfirmasi);
