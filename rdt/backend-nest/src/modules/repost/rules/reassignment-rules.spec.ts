import {
  validateReassignTarget,
  REASSIGN_CAP,
  buildValidCodeMap,
} from './reassignment-rules';

const validCodes = buildValidCodeMap([
  { code: 'TB' },
  { code: 'TC' },
  { code: 'TF' },
  { code: 'TJ' },
  { code: 'TL' },
  { code: 'TN' },
  { code: 'Corp' },
]);

test('accepts a valid, distinct, active target', () => {
  const r = validateReassignTarget({
    newTarget: 'TF',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(true);
  expect((r as { newTargetUpper: string }).newTargetUpper).toBe('TF');
});

test('is case-insensitive on the target code', () => {
  const r = validateReassignTarget({
    newTarget: 'tf',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(true);
  expect((r as { newTargetUpper: string }).newTargetUpper).toBe('TF');
});

// BUG FIX (5 Agu, live report — "assign ke Corp gagal 500, FK violation"): the returned value
// used to be newTarget.toUpperCase() unconditionally, e.g. 'CORP' — but rdt.dinas stores this
// specific code mixed-case ('Corp'), and every caller INSERTs the returned value straight into
// transactions.dinas_target, which has an FK to rdt.dinas.code. 'CORP' has no matching row, so
// this silently corrupted every attempt to reassign/split/investigate-assign to Corp.
test('preserves the target dinas actual stored case (e.g. "Corp", not "CORP") regardless of input case', () => {
  const lower = validateReassignTarget({
    newTarget: 'corp',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(lower.ok).toBe(true);
  expect((lower as { newTargetUpper: string }).newTargetUpper).toBe('Corp');

  const upper = validateReassignTarget({
    newTarget: 'CORP',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(upper.ok).toBe(true);
  expect((upper as { newTargetUpper: string }).newTargetUpper).toBe('Corp');

  const mixed = validateReassignTarget({
    newTarget: 'Corp',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(mixed.ok).toBe(true);
  expect((mixed as { newTargetUpper: string }).newTargetUpper).toBe('Corp');
});

test('buildValidCodeMap keys uppercase for lookup, values keep the original stored case', () => {
  // The Map's own keys are plain (case-sensitive) — callers uppercase their lookup key before
  // .get() (as validateReassignTarget does internally), not the Map itself.
  const map = buildValidCodeMap([{ code: 'Corp' }, { code: 'TB' }]);
  expect(map.get('corp'.toUpperCase())).toBe('Corp');
  expect(map.get('CORP')).toBe('Corp');
  expect(map.get('TB')).toBe('TB');
});

test('rejects when reassign_count is already at the cap', () => {
  const r = validateReassignTarget({
    newTarget: 'TF',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: REASSIGN_CAP,
  });
  expect(r.ok).toBe(false);
  expect((r as { httpStatus: number }).httpStatus).toBe(400);
  expect((r as { error: string }).error).toMatch(/cap/i);
});

test('rejects a missing new_dinas_target', () => {
  const r = validateReassignTarget({
    newTarget: undefined,
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/required/i);
});

test('rejects a target that is not a known active dinas', () => {
  const r = validateReassignTarget({
    newTarget: 'ZZ',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/not a known active dinas/i);
});

test('rejects reassigning back to the original uploader dinas', () => {
  const r = validateReassignTarget({
    newTarget: 'TB',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/original uploader/i);
});

test('rejects reassigning to the dinas that just declined', () => {
  const r = validateReassignTarget({
    newTarget: 'TC',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: 0,
  });
  expect(r.ok).toBe(false);
  expect((r as { error: string }).error).toMatch(/just declined/i);
});

test('allows exactly REASSIGN_CAP - 1 prior reassignments (the last one still allowed)', () => {
  const r = validateReassignTarget({
    newTarget: 'TF',
    validCodes,
    dinasInisiasi: 'TB',
    currentDinasTarget: 'TC',
    reassignCount: REASSIGN_CAP - 1,
  });
  expect(r.ok).toBe(true);
});
