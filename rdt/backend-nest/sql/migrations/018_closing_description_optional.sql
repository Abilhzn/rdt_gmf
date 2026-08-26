-- Project owner request (12 Agu): closing_description on POST /api/export-batches/confirm was
-- mandatory (migration 006 explicitly set it NOT NULL, and SRS.md 3.9 called it out by name as
-- "MEMANG wajib diisi" to contrast against Confirmation's own optional description field) —
-- reversed: TAB can now confirm/repost a pair without typing a closing note at all.
--
-- Runs on every server start (no migration-tracking table, see migrate.js) -- every statement
-- here must be idempotent.
ALTER TABLE rdt.export_batches ALTER COLUMN closing_description DROP NOT NULL;
