-- SRS.md 3.3 SUPERSEDED 30 Jul (REQ-RDT-SAP-03..06, correction from live TAB team meeting): approval
-- unit changes AGAIN, from one row per dinas_inisiasi (29 Jul, migration 006 -- turned out wrong,
-- TAB itself corrected this in the 30 Jul meeting) to one row PER PASANGAN (dinas_inisiasi,
-- dinas_target), processed in parallel/async so one slow target dinas never blocks another pair
-- from the same initiator.
--
-- Runs on every server start (no migration-tracking table, see migrate.js) -- every statement
-- here must be idempotent.

ALTER TABLE rdt.export_batches ADD COLUMN IF NOT EXISTS dinas_target text REFERENCES rdt.dinas(code);

-- One-time cleanup of the 29 Jul per-dinas_inisiasi model's rows (this session's testing left 4
-- behind, id 2/3/4/5, all dev data, 0 currently-linked transactions -- confirmed with project
-- owner before writing this). dinas_target IS NULL means "existed before this migration ever
-- ran" -- a real confirmed batch under the per-pasangan model always has dinas_target set at
-- insert time, so this WHERE clause is only ever true for pre-migration rows and becomes a
-- permanent no-op after the first run. Critical: must NOT be an unconditional wipe, since this
-- migration re-runs on every server start and would otherwise delete real confirmed batches.
UPDATE rdt.transactions SET export_batch_id = NULL
  WHERE export_batch_id IN (SELECT id FROM rdt.export_batches WHERE dinas_target IS NULL);
DELETE FROM rdt.export_batches WHERE dinas_target IS NULL;

-- Safe to add NOT NULL directly (not backfill-then-constrain): the cleanup above always empties
-- the table on its first run, same reasoning as migration 006. From then on, rows only ever come
-- from POST /confirm, which always inserts dinas_target together with the other columns.
ALTER TABLE rdt.export_batches ALTER COLUMN dinas_target SET NOT NULL;
