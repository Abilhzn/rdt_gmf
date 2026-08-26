import { validatePeriodAndDeadline } from './validate-period-and-deadline';

test('accepts a valid periode + deadline_at', () => {
  const r = validatePeriodAndDeadline({
    periode: '2026-07',
    deadline_at: '2026-08-01T00:00:00Z',
  });
  expect(r.ok).toBe(true);
  expect((r as { deadlineAt: Date }).deadlineAt).toBeInstanceOf(Date);
});

test('rejects a periode not matching YYYY-MM', () => {
  const r = validatePeriodAndDeadline({
    periode: '2026-7',
    deadline_at: '2026-08-01T00:00:00Z',
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/YYYY-MM/);
});

test('rejects a missing periode', () => {
  const r = validatePeriodAndDeadline({
    periode: undefined,
    deadline_at: '2026-08-01T00:00:00Z',
  });
  expect(r.ok).toBe(false);
});

test('rejects a missing deadline_at', () => {
  const r = validatePeriodAndDeadline({
    periode: '2026-07',
    deadline_at: null,
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/valid date/);
});

test('rejects an unparseable deadline_at', () => {
  const r = validatePeriodAndDeadline({
    periode: '2026-07',
    deadline_at: 'not-a-date',
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/valid date/);
});
