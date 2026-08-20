const mappingSeed = require('../src/config/mapping.seed.json');

// The real-file "Ask TA" -> NEEDS_INVESTIGATION regression (previously against the retired
// contoh_input/06. DT TJ JUN 2026 R1.xlsx) now lives in parser.test.js, against the current
// Format CBO 06. DT TJ - Jun 2026.xlsx (Recipient="Ask TA" instead of the old Review-column
// fallback).

// mapping.seed.json must never resolve "Ask TA" to a dinas again — that was the 25/28 Jul
// behavior this requirement explicitly supersedes.
test('mapping.seed.json no longer maps "Ask TA" to any dinas', () => {
  expect(mappingSeed['Ask TA']).toBeUndefined();
});
