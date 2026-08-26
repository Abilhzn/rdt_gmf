-- Section 3.10 "PERSEMPIT SCOPE" (4 Agu 2026, project owner revision): share-cost split now only
-- exposes rows whose dinas_target is ALREADY DIRECTLY 'TAB' as candidates (routes/shareCost.js's
-- GET /candidates) -- previously TAB deliberately had no row in rdt.dinas at all (see schema.sql's
-- seed comment, and config/dinas.codes.json's updated comment for the full history of why that
-- changed). A dinas_target of 'TAB' now needs to satisfy the transactions_dinas_target_fkey.
--
-- is_active=false ON PURPOSE: 'TAB' must be a valid FK target and a valid parser-resolvable
-- Remarks prefix (see dinas.codes.json), but must NOT appear in any is_active=true dinas picker
-- the way a real operational dinas would (e.g. reassignment.js's REASSIGN target dropdown,
-- confirmation.js's validCodes check) -- it was never meant to become a general reassign/redirect
-- destination, only a share-cost-candidate marker.
INSERT INTO rdt.dinas (code, name, is_active) VALUES ('TAB', 'TAB (admin RDT)', false)
ON CONFLICT (code) DO NOTHING;
