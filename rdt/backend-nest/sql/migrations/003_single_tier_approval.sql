-- Simplify export approval from tiered SM -> GH to single TAB approval (project owner
-- correction, 24 Jul 2026): SM_TA/GH_TA roles removed entirely — role TAB now handles all of
-- Repost/Confirmation/Need Approval, including approving a batch once every transaction is
-- resolved ("100% dan tidak ada miscommunication"). Runs on every server start (no migration-
-- tracking table in this project, see migrate.js) — every statement here must be idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rdt' AND table_name = 'export_batches' AND column_name = 'sm_approved_by_user_id'
  ) THEN
    ALTER TABLE rdt.export_batches RENAME COLUMN sm_approved_by_user_id TO approved_by_user_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rdt' AND table_name = 'export_batches' AND column_name = 'sm_approved_at'
  ) THEN
    ALTER TABLE rdt.export_batches RENAME COLUMN sm_approved_at TO approved_at;
  END IF;
END $$;

ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS gh_approved_by_user_id;
ALTER TABLE rdt.export_batches DROP COLUMN IF EXISTS gh_approved_at;

-- NOTE (29 Jul, added by 006_export_batches_per_dinas.sql): the status column this block
-- operates on was later dropped entirely (WAITING/CONFIRMED became a computed state, not a
-- stored one — see 006's header comment). Guarded on the column still existing so this migration
-- stays a harmless no-op on every server start from here on, instead of erroring once 006 has run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rdt' AND table_name = 'export_batches' AND column_name = 'status'
  ) THEN
    UPDATE rdt.export_batches SET status = 'WAITING_APPROVAL' WHERE status IN ('WAITING_SM', 'WAITING_GH');
    ALTER TABLE rdt.export_batches DROP CONSTRAINT IF EXISTS export_batches_status_check;
    ALTER TABLE rdt.export_batches
      ADD CONSTRAINT export_batches_status_check
      CHECK (status IN ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'EXPORTED', 'CANCELLED'));
  END IF;
END $$;
