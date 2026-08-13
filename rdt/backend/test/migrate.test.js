const { isDinasRosterComplete, MIN_EXPECTED_DINAS } = require('../src/migrate');

// Audit finding, 13 Agu (SRS.md "Bug ditemukan 8 Agu, PRIORITAS TERTINGGI" — root cause was
// likely tools/backfillMigrationsApplied.js marking migrations "applied" without verifying
// rdt.dinas actually got its roster). runMigrations() now fails loud at boot if the roster looks
// incomplete — this tests just the threshold predicate (no DB needed).
describe('isDinasRosterComplete', () => {
  test(`below ${MIN_EXPECTED_DINAS} -> incomplete`, () => {
    expect(isDinasRosterComplete(MIN_EXPECTED_DINAS - 1)).toBe(false);
  });

  test(`exactly ${MIN_EXPECTED_DINAS} -> complete`, () => {
    expect(isDinasRosterComplete(MIN_EXPECTED_DINAS)).toBe(true);
  });

  test('fully-migrated count (~28, Corp + inactive placeholders included) -> complete', () => {
    expect(isDinasRosterComplete(28)).toBe(true);
  });

  test('empty/fresh-but-broken database (0 rows) -> incomplete', () => {
    expect(isDinasRosterComplete(0)).toBe(false);
  });
});
