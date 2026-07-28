// Pure validation rules for REQ-RDT-LEDGER-07 REASSIGN — separated from routes/reassignment.js
// so the business rules (cap, eligible targets) are unit-testable without a DB connection.

const REASSIGN_CAP = 3;

// validCodes: Set<string> of active dinas codes (already uppercased).
// dinasInisiasi / currentDinasTarget: the transaction's existing values.
// Returns { ok: true, newTargetUpper } or { ok: false, error, httpStatus }.
function validateReassignTarget({ newTarget, validCodes, dinasInisiasi, currentDinasTarget, reassignCount }) {
  if (reassignCount >= REASSIGN_CAP) {
    return { ok: false, httpStatus: 400, error: `reassign_count already at cap (${REASSIGN_CAP}) — this transaction must be resolved with action=BORNE` };
  }
  if (!newTarget || typeof newTarget !== 'string') {
    return { ok: false, httpStatus: 400, error: 'new_dinas_target is required for action=REASSIGN' };
  }
  const newTargetUpper = newTarget.toUpperCase();
  if (!validCodes.has(newTargetUpper)) {
    return { ok: false, httpStatus: 400, error: `new_dinas_target '${newTarget}' is not a known active dinas` };
  }
  if (newTargetUpper === String(dinasInisiasi).toUpperCase()) {
    return { ok: false, httpStatus: 400, error: 'cannot reassign back to the original uploader dinas' };
  }
  if (newTargetUpper === String(currentDinasTarget).toUpperCase()) {
    return { ok: false, httpStatus: 400, error: 'cannot reassign to the dinas that just declined' };
  }
  return { ok: true, newTargetUpper };
}

module.exports = {
  REASSIGN_CAP,
  validateReassignTarget,
};
