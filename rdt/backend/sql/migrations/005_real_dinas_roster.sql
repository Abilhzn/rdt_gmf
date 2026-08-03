-- Correct the synthetic placeholder dinas roster (29 Jul 2026, project owner): the roster seeded
-- by schema.sql was literally "T" + every letter A-U sequentially, guessed before the real org
-- structure was available -- not GMF's actual GH-level structure. Replaced with the real 21-GH
-- roster from struktur-dinas-gmf.png (project owner supplied). TG/TK/TO/TT never existed as real
-- dinas -- deactivated (not deleted) so any existing FK-referenced rows (transactions, audit_log,
-- dinas_mapping) stay intact. TV/TX/TZ/DFR are real GH units that were simply missing before.
-- The 17 unchanged codes keep their code (already correct) but get their display name corrected
-- from the placeholder "Dinas <code>" to the real GH name. This migration only fixes roster
-- membership/names, not authorization -- see schema.sql's rdt.dinas seed comment for the current
-- (REQ-RDT-AUTH-05, corrected 31 Jul 2026) authorization story: only 'Corp' has no dedicated PIC,
-- TA has its own like any other dinas. Runs on every server start (no migration-tracking table in
-- this project, see migrate.js) -- every statement here must be idempotent.

UPDATE rdt.dinas SET name = 'Financial & Management Accounting GH' WHERE code = 'TA';
UPDATE rdt.dinas SET name = 'Widebody Base Maintenance GH' WHERE code = 'TB';
UPDATE rdt.dinas SET name = 'Component Services GH' WHERE code = 'TC';
UPDATE rdt.dinas SET name = 'Corporate Strategy & Digital Transformation GH' WHERE code = 'TD';
UPDATE rdt.dinas SET name = 'Engineering Services GH' WHERE code = 'TE';
UPDATE rdt.dinas SET name = 'Maintenance Planning GH' WHERE code = 'TF';
UPDATE rdt.dinas SET name = 'Human Capital Management GH' WHERE code = 'TH';
UPDATE rdt.dinas SET name = 'Internal Audit GH' WHERE code = 'TI';
UPDATE rdt.dinas SET name = 'Narrowbody Base Maintenance GH' WHERE code = 'TJ';
UPDATE rdt.dinas SET name = 'Line Maintenance GH' WHERE code = 'TL';
UPDATE rdt.dinas SET name = 'Material & Logistic Services GH' WHERE code = 'TM';
UPDATE rdt.dinas SET name = 'Cabin Services GH' WHERE code = 'TN';
UPDATE rdt.dinas SET name = 'Sales & Marketing GH' WHERE code = 'TP';
UPDATE rdt.dinas SET name = 'Quality Assurance & Safety GH' WHERE code = 'TQ';
UPDATE rdt.dinas SET name = 'SBU Defense Industry GH' WHERE code = 'TR';
UPDATE rdt.dinas SET name = 'Corporate Secretary & Legal GH' WHERE code = 'TS';
UPDATE rdt.dinas SET name = 'Corporate Affairs & HSE GH' WHERE code = 'TU';

INSERT INTO rdt.dinas (code, name) VALUES
  ('TV','Engine Services GH'),
  ('TX','Treasury Management GH'),
  ('TZ','Aircraft Support & Power Services GH'),
  ('DFR','Management Risk GH')
ON CONFLICT (code) DO NOTHING;

-- TG/TK/TO/TT were never real GH units (synthetic placeholder codes).
UPDATE rdt.dinas SET is_active = false WHERE code IN ('TG', 'TK', 'TO', 'TT');
