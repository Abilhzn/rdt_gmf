const { validateReassignTarget, REASSIGN_CAP } = require('../src/rules/reassignmentRules');

const validCodes = new Set(['TB', 'TC', 'TF', 'TJ', 'TL', 'TN', 'CORP']);

test('accepts a valid, distinct, active target', () => {
  const r = validateReassignTarget({ newTarget: 'TF', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(true);
  expect(r.newTargetUpper).toBe('TF');
});

test('is case-insensitive on the target code', () => {
  const r = validateReassignTarget({ newTarget: 'tf', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(true);
  expect(r.newTargetUpper).toBe('TF');
});

test('rejects when reassign_count is already at the cap', () => {
  const r = validateReassignTarget({ newTarget: 'TF', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: REASSIGN_CAP });
  expect(r.ok).toBe(false);
  expect(r.httpStatus).toBe(400);
  expect(r.error).toMatch(/cap/i);
});

test('rejects a missing new_dinas_target', () => {
  const r = validateReassignTarget({ newTarget: undefined, validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/required/i);
});

test('rejects a target that is not a known active dinas', () => {
  const r = validateReassignTarget({ newTarget: 'ZZ', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/not a known active dinas/i);
});

test('rejects reassigning back to the original uploader dinas', () => {
  const r = validateReassignTarget({ newTarget: 'TB', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/original uploader/i);
});

test('rejects reassigning to the dinas that just declined', () => {
  const r = validateReassignTarget({ newTarget: 'TC', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: 0 });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/just declined/i);
});

test('allows exactly REASSIGN_CAP - 1 prior reassignments (the last one still allowed)', () => {
  const r = validateReassignTarget({ newTarget: 'TF', validCodes, dinasInisiasi: 'TB', currentDinasTarget: 'TC', reassignCount: REASSIGN_CAP - 1 });
  expect(r.ok).toBe(true);
});
