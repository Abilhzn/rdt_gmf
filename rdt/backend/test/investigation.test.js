const mappingSeed = require('../src/config/mapping.seed.json');

// Retired 20 Agu: this file used to also cover contoh_input/06. DT TJ JUN 2026 R1.xlsx's 3 real
// "Ask TA" rows getting NEEDS_INVESTIGATION (parseExcelFile-based). That fixture is intentionally
// not being replaced (see parser.test.js's retirement note for why) — parser.js's "Ask TA"
// carve-out logic itself is untouched, this just lost its dedicated real-file regression coverage.

// mapping.seed.json must never resolve "Ask TA" to a dinas again — that was the 25/28 Jul
// behavior this requirement explicitly supersedes.
test('mapping.seed.json no longer maps "Ask TA" to any dinas', () => {
  expect(mappingSeed['Ask TA']).toBeUndefined();
});
