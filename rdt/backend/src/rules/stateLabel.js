// Derived "who's holding the ball" label for a dinas pair (not a stored column). Kept as a pure
// function so dashboard.js and exportBatches.js can each pass in their own already-queried counts.

// pendingCount: transactions still PENDING for this pair. targetDinas: this pair's dinas_target.
// subdocNumbers: subdoc numbers for this pair's confirmed batch, if it has reached that stage.
function deriveStateLabel({ pendingCount, targetDinas, subdocNumbers }) {
  if (pendingCount > 0) return `Waiting for confirmation ${targetDinas}`;
  if (subdocNumbers && subdocNumbers.length) return `Reposted by TAB with subdoc ${subdocNumbers.join(', ')}`;
  return 'Waiting to repost';
}

module.exports = { deriveStateLabel };
