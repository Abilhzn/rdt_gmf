// REQ-RDT-COMMENT-03: parse @mentions out of a comment body and resolve them to the user_ids
// that should be notified. Separated from routes/dashboard.js so the parsing/resolution logic
// is unit-testable without a DB connection, same rationale as reassignmentRules.js.
//
// Two mention forms, matching what the Repost description's @mention autocomplete already lets
// people insert (see ui-demo.html's mentionOptions()): a specific user_id (@demo-pic-tj) or a
// dinas code (@TJ) — a dinas mention fans out to every directory entry whose `dinas` matches
// (today that's exactly one PIC per dinas, but this generalizes if a dinas ever gets more than
// one login). This is PURELY for notification targeting — it never changes transaction state.

function extractMentionTokens(body) {
  const matches = String(body || '').match(/@([\w-]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

// REQ-RDT-COMMENT-04 (31 Jul morning, gap found in code review) INTRODUCED a DINAS_TOKEN_ALIASES
// = { TA: 'TAB' } here on the assumption that "TA" had been retired and merged into "TAB". That
// assumption was WRONG and got corrected the same day (REQ-RDT-AUTH-05, 31 Jul afternoon
// presentation feedback): TA is its own operational dinas with its own PIC, distinct from TAB.
// The alias has been removed — @TA now resolves the normal way, via the dinas-fan-out lookup
// below matching directory entries with dinas='TA' (see employee-directory.seed.json's demo-ta).

// directory: the employee-directory.seed.json shape, { user_id: { dinas, role, display_name } }.
function resolveMentionedUserIds(body, directory) {
  const tokens = extractMentionTokens(body);
  const userIds = new Set();
  for (const token of tokens) {
    if (directory[token]) { userIds.add(token); continue; }
    const tokenUpper = token.toUpperCase();
    Object.keys(directory).forEach((id) => {
      if (String(directory[id].dinas).toUpperCase() === tokenUpper) userIds.add(id);
    });
  }
  return Array.from(userIds);
}

module.exports = { extractMentionTokens, resolveMentionedUserIds };
