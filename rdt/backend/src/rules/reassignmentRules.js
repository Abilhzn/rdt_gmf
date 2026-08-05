// Pure validation rules for REQ-RDT-LEDGER-07 REASSIGN — separated from routes/reassignment.js
// so the business rules (cap, eligible targets) are unit-testable without a DB connection.

const REASSIGN_CAP = 3;

// BUG FIX (5 Agu, live report — "assign ke Corp gagal 500, FK violation"): every caller used to
// build validCodes as a Set of UPPERCASED codes, and validateReassignTarget returned that SAME
// uppercased string as the value callers then INSERT into transactions.dinas_target. That's fine
// for a normal 2-letter dinas code (already stored uppercase, e.g. 'TC'), but rdt.dinas
// deliberately stores a few codes mixed-case ('Corp' — see dinas.codes.json/schema.sql's seed
// comments) — uppercasing 'Corp' to 'CORP' before the INSERT violates transactions_dinas_target_
// fkey since no row with THAT exact case exists. buildValidCodeMap preserves the actual stored
// case (uppercase key for case-INSENSITIVE lookup, original-case value for the INSERT) so this
// class of bug can't recur at any call site that uses it.
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
// legacy field name kept for every existing call site's `validation.newTargetUpper` destructuring
// — despite the name, its VALUE is now the target's actual stored case, not necessarily uppercase
// (e.g. 'Corp', not 'CORP') — that's the whole point of this fix.
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
