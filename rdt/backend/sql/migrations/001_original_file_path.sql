-- REQ-RDT-EXT-08 / REQ-RDT-LEDGER-09: original uploaded Excel file (byte-for-byte, formulas
-- intact) is now saved alongside the parsed rows — this column records where to find it on
-- disk. Written as a separate migration file (not folded into schema.sql, which has already
-- been applied) per project owner instruction; idempotent like schema.sql's own ALTER ADD
-- COLUMN IF NOT EXISTS pattern, so re-running it is safe.
ALTER TABLE rdt.uploads ADD COLUMN IF NOT EXISTS original_file_path text;
