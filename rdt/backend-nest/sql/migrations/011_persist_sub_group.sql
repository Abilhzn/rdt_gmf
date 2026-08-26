-- REQ-RDT-NAV-04 (diperluas 1 Agu, DITEGASKAN LAGI 3 Agu): "Sub Group" was only ever a
-- parse-time field on the pre-persist preview object (excelParser.js's buildDetailRow) — dropped
-- before the INSERT into rdt.transactions, same as reviewer_note. That made it impossible for
-- "SEMUA kolom yang sama seperti yang benar-benar ikut ter-repost" to actually hold once a row
-- moved past the Repost Review screen: Need Approval's transparency view, Dashboard-Detailing,
-- and Confirmation can never show Sub Group for an already-persisted transaction, no matter how
-- the preview column source is wired, because the data itself was never saved.
ALTER TABLE rdt.transactions ADD COLUMN IF NOT EXISTS sub_group text;
