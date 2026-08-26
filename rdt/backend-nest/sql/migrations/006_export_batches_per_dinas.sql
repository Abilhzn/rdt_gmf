-- SRS.md 3.3 SUPERSEDED 29 Jul (REQ-RDT-SAP-03..06): approval unit changes from a single global
-- batch (24 Jul) / an approval-less per-pasangan draft (27 Jul) to one row PER DINAS PENGAJU,
-- covering every pair that dinas submitted, gated on a mandatory closing_description. Neither
-- prior model survives -- this replaces both, it doesn't run alongside them.
--
-- Design (confirmed with project owner): "WAITING" is a computed state, never stored -- no row
-- exists in rdt.export_batches until TAB actually confirms, so every row that exists from this
-- point on IS a confirmed entry (no status column needed). No EXPORTED state either -- download
-- is a stateless, repeatable per-pair action once confirmed, not a one-time whole-batch
-- transition.
--
-- Runs on every server start (no migration-tracking table in this project, see migrate.js) --
-- every statement here must be idempotent.

ALTER TABLE rdt.export_batches ADD COLUMN IF NOT EXISTS dinas_inisiasi text REFERENCES rdt.dinas(code);
ALTER TABLE rdt.export_batches ADD COLUMN IF NOT EXISTS closing_description text;

-- One-time cleanup of the OLD global-batch model's rows (this session's earlier testing left one
-- behind, spanning many dinas at once -- incompatible with the new one-row-per-dinas shape).
-- dinas_inisiasi IS NULL means "existed before this migration ever ran" -- a real confirmed batch
-- under the new model always has dinas_inisiasi set at insert time, so this WHERE clause is only
-- ever true for pre-migration rows and becomes a permanent no-op after the first run. Critical:
-- this must NOT be an unconditional wipe, since this migration re-runs on every server start and
-- would otherwise silently delete every real confirmed batch on the next restart.
UPDATE rdt.transactions SET export_batch_id = NULL
  WHERE export_batch_id IN (SELECT id FROM rdt.export_batches WHERE dinas_inisiasi IS NULL);
DELETE FROM rdt.export_batches WHERE dinas_inisiasi IS NULL;

ALTER TABLE rdt.export_batches DROP CONSTRAINT IF EXISTS export_batches_status_check;
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS status;
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS period;
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS export_filename;
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS created_by_user_id;
-- No EXPORTED state under the new model (see header comment) -- download is a stateless,
-- repeatable per-pair action, nothing left to timestamp at the batch level.
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS exported_at;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rdt' AND table_name = 'export_batches' AND column_name = 'approved_by_user_id'
  ) THEN
    ALTER TABLE rdt.export_batches RENAME COLUMN approved_by_user_id TO confirmed_by_user_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rdt' AND table_name = 'export_batches' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE rdt.export_batches RENAME COLUMN approved_at TO confirmed_at;
  END IF;
END $$;

-- Safe to add NOT NULL directly (not backfill-then-constrain): every pre-migration row had
-- dinas_inisiasi IS NULL (the column didn't exist yet when it was inserted), so the cleanup above
-- always empties the table on its first run. From then on, rows only ever come from the new
-- POST /confirm endpoint, which always inserts all four columns together in one statement.
ALTER TABLE rdt.export_batches ALTER COLUMN dinas_inisiasi SET NOT NULL;
ALTER TABLE rdt.export_batches ALTER COLUMN closing_description SET NOT NULL;
ALTER TABLE rdt.export_batches ALTER COLUMN confirmed_by_user_id SET NOT NULL;
ALTER TABLE rdt.export_batches ALTER COLUMN confirmed_at SET NOT NULL;
