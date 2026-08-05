-- REQ-RDT-NAV-04 / SRS 3.11 (5 Agu, project owner clarification): the sticky "Notes" column in
-- Confirmation's DT preview was pinning `remark` (the raw Excel Remarks column, used for dinas-
-- routing derivation) — but "Notes" is supposed to be the free-text note the UPLOADING user
-- writes per-row on the Repost Review screen ("Catatan Reviewer" / reviewer_note), not Remark.
-- Same gap as sub_group (migration 011): reviewer_note was ALWAYS frontend-only, deliberately
-- stripped before POST /api/persist (see transaction.model.ts's comment, "FRONTEND-ONLY... SRS
-- flags where this should ultimately be stored as still open... don't guess/migrate until the
-- project owner confirms") — this migration is that confirmation.
ALTER TABLE rdt.transactions ADD COLUMN IF NOT EXISTS reviewer_note text;
