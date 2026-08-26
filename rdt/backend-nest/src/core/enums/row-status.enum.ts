export enum RowStatus {
  PENDING = 'PENDING',
  EXCLUDED = 'EXCLUDED',
  INVALID = 'INVALID',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  // Recipient == "Ask TA" — not a dinas, ambiguous ownership, needs manual TAB investigation
  // (dinas_target stays null). Distinct from NEEDS_REVIEW ("unmapped code").
  NEEDS_INVESTIGATION = 'NEEDS_INVESTIGATION',
}
