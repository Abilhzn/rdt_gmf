// REQ-RDT-SAP-07 (SRS.md 3.3, 30 Jul): derived display label for "who's holding the ball" on a
// pair, computed from status_konfirmasi + repost stage -- NOT a stored column, so this stays a
// pure function callers pass their own already-queried counts into (dashboard.js's
// buildNeedToConfirmProgress and routes/exportBatches.js both need it, with different queries
// behind them -- unit-testable without a DB connection, same rationale as reassignmentRules.js).

// pendingCount: transactions still PENDING for this pair (0 once every row is resolved).
// targetDinas: this pair's dinas_target, interpolated into the "waiting on" label.
// subdocNumbers: subdoc numbers already entered for this pair's confirmed batch, if any --
//   omit/empty for a pair that hasn't reached that stage yet (still waiting or just confirmed).
function deriveStateLabel({ pendingCount, targetDinas, subdocNumbers }) {
  if (pendingCount > 0) return `Waiting for confirmation ${targetDinas}`;
  if (subdocNumbers && subdocNumbers.length) return `Reposted by TAB with subdoc ${subdocNumbers.join(', ')}`;
  return 'Waiting to repost';
}

module.exports = { deriveStateLabel };
