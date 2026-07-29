-- REQ-RDT-SAP-08 (SRS.md 3.3, 30 Jul): a single confirmed pair/batch can produce MORE THAN ONE
-- SAP subdoc reference number -- SAP caps line items at ~300 per document, so TAB splits a large
-- pair's repost into several subdocs. One-to-many relation, not a single `subdoc` column on
-- export_batches.
--
-- Subdoc entry is a SEPARATE step from POST /confirm (confirmed with project owner 30 Jul): the
-- Confirm action only ever requires closing_description (see exportBatches.js), so a batch can
-- sit confirmed with zero subdocs for a while (the pair's state label stays "Waiting to repost"
-- during that window) before TAB adds the first one, which is what actually flips the label to
-- "Reposted by TAB with subdoc [...]" and triggers auto-archive (REQ-RDT-SAP-09).
--
-- Runs on every server start (no migration-tracking table, see migrate.js) -- every statement
-- here must be idempotent.

CREATE TABLE IF NOT EXISTS rdt.export_subdocs (
  id            bigserial PRIMARY KEY,
  batch_id      bigint NOT NULL REFERENCES rdt.export_batches(id),
  subdoc_number text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_export_subdocs_batch ON rdt.export_subdocs (batch_id);
