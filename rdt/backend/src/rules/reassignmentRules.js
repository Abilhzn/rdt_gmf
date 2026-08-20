// Pure validation rules for REASSIGN — separated from routes/reassignment.js
// so the business rules (cap, eligible targets) are unit-testable without a DB connection.

const REASSIGN_CAP = 3;

// rdt.dinas deliberately stores a few codes mixed-case ('Corp') — uppercasing before INSERT would
// violate transactions_dinas_target_fkey since no row with that exact case exists. buildValidCodeMap
// preserves the actual stored case (uppercase key for case-insensitive lookup, original-case value
// for the INSERT) so callers never re-case a code before writing it.
function buildValidCodeMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const code = row && row.code;
    if (code == null) continue;
    map.set(String(code).toUpperCase(), String(code));
  }
  return map;
}

// validCodes: Map<uppercased code, actual stored-case code> — see buildValidCodeMap above.
// dinasInisiasi / currentDinasTarget: the transaction's existing values.
// Returns { ok: true, newTargetUpper } or { ok: false, error, httpStatus }. `newTargetUpper` is a
// legacy field name — its value is the target's actual stored case, not necessarily uppercase.
function validateReassignTarget({ newTarget, validCodes, dinasInisiasi, currentDinasTarget, reassignCount }) {
  if (reassignCount >= REASSIGN_CAP) {
    return { ok: false, httpStatus: 400, error: `reassign_count already at cap (${REASSIGN_CAP}) — this transaction must be resolved with action=BORNE` };
  }
  if (!newTarget || typeof newTarget !== 'string') {
    return { ok: false, httpStatus: 400, error: 'new_dinas_target is required for action=REASSIGN' };
  }
  const lookupKey = newTarget.toUpperCase();
  const matchedCode = validCodes.get(lookupKey);
  if (!matchedCode) {
    return { ok: false, httpStatus: 400, error: `new_dinas_target '${newTarget}' is not a known active dinas` };
  }
  if (lookupKey === String(dinasInisiasi).toUpperCase()) {
    return { ok: false, httpStatus: 400, error: 'cannot reassign back to the original uploader dinas' };
  }
  if (lookupKey === String(currentDinasTarget).toUpperCase()) {
    return { ok: false, httpStatus: 400, error: 'cannot reassign to the dinas that just declined' };
  }
  return { ok: true, newTargetUpper: matchedCode };
}

module.exports = {
  REASSIGN_CAP,
  validateReassignTarget,
  buildValidCodeMap,
};
