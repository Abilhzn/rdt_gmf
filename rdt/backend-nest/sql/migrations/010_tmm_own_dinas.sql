-- REQ-RDT-AUTH-05/TMM correction (31 Jul 2026, project owner, presentation feedback): TMM is its
-- OWN dinas with its own repost business, NOT a sub-unit of TM reachable by truncating a 3-letter
-- code to its 2-letter prefix. A 28 Jul theory ("GMF-wide sub-dinas suffix convention") had
-- excelParser.js fold every "TMM" value into dinas_target='TM' -- TAB explicitly reasserted this
-- is wrong. See dinas.codes.json's comment for the parser-side half of this fix (adding 'TMM' to
-- the canonical roster makes it resolve directly via an exact-code match, ahead of the sub-dinas
-- fallback -- no parser logic itself changed).
INSERT INTO rdt.dinas (code, name) VALUES ('TMM', 'TMM')
ON CONFLICT (code) DO NOTHING;
