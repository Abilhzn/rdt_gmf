const { computeEffectivePeriod, addMonths } = require('../src/rules/periodEffective');

describe('addMonths', () => {
  test('adds within the same year', () => {
    expect(addMonths('2026-06', 1)).toBe('2026-07');
  });

  test('wraps into the next year', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
});

describe('computeEffectivePeriod (REQ-RDT-SAP-14, revisi total 5 Agu)', () => {
  test('no deadline set for this pasangan+periode -> normal, not overdue (opt-in, poin 5)', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-06',
      deadlineAt: null,
      latestTargetActionAt: '2026-07-15T00:00:00Z',
    });
    expect(result).toEqual({ periodeEfektif: '2026-06', overdue: false });
  });

  test('pasangan belum resolved (latestTargetActionAt null) -> defensif, normal', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-06',
      deadlineAt: '2026-06-25T23:59:59Z',
      latestTargetActionAt: null,
    });
    expect(result).toEqual({ periodeEfektif: '2026-06', overdue: false });
  });

  test('dinas target confirm SEBELUM deadline -> periode efektif tidak berubah', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-06',
      deadlineAt: '2026-06-25T23:59:59Z',
      latestTargetActionAt: '2026-06-20T10:00:00Z',
    });
    expect(result).toEqual({ periodeEfektif: '2026-06', overdue: false });
  });

  test('dinas target confirm PERSIS di deadline -> masih dianggap on-time (<=, bukan <)', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-06',
      deadlineAt: '2026-06-25T23:59:59Z',
      latestTargetActionAt: '2026-06-25T23:59:59Z',
    });
    expect(result).toEqual({ periodeEfektif: '2026-06', overdue: false });
  });

  test('dinas target confirm SETELAH deadline -> periode efektif geser ke bulan berikutnya, overdue', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-06',
      deadlineAt: '2026-06-25T23:59:59Z',
      latestTargetActionAt: '2026-07-02T09:00:00Z',
    });
    expect(result).toEqual({ periodeEfektif: '2026-07', overdue: true });
  });

  test('geser periode wrap tahun dengan benar (Desember -> Januari tahun depan)', () => {
    const result = computeEffectivePeriod({
      declaredPeriod: '2026-12',
      deadlineAt: '2026-12-20T00:00:00Z',
      latestTargetActionAt: '2026-12-21T00:00:00Z',
    });
    expect(result).toEqual({ periodeEfektif: '2027-01', overdue: true });
  });
});
