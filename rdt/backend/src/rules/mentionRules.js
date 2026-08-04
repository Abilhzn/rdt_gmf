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

// Privacy bug (reported 3 Agu, STILL LEAKING 4 Agu — this is the actual root-cause fix): every
// call site that builds a comment's recipient list unions resolveMentionedUserIds(fullText, ...)
// with an implicit pair-scoped recipient, but never restricted the MENTION side to that same
// pair. A broadcast description that @mentions multiple dinas at once (e.g. a Repost upload
// touching both TA and TMM, description "@TA @TMM tolong konfirmasi") creates ONE comment PER
// pair, but resolveMentionedUserIds resolves the WHOLE shared text every time — so TMM's PIC
// ends up on the TJ->TA comment's recipient list too, and vice versa. Since GET /api/notifications
// joins through to the comment's own transaction to show dinas_inisiasi/dinas_target, that
// mis-scoped recipient row is exactly how TA's (correctly recipient_user_id-scoped) notification
// feed ends up showing a TJ->TMM entry — TA can see TMM also got notified from the same message,
// which is precisely what REQ-RDT-COMMENT-03 says must never happen. The fix has to happen at
// RECIPIENT SELECTION time, not at query time (the query was already correctly scoped) — every
// mentioned user must belong to the pair the comment is actually anchored to (or be TAB, who
// legitimately oversees every pair) before being added as a recipient.
function filterMentionsToPair(userIds, directory, allowedDinasCodes) {
  const allowedUpper = new Set(allowedDinasCodes.filter(Boolean).map((d) => String(d).toUpperCase()));
  return userIds.filter((id) => {
    const entry = directory[id];
    if (!entry) return false;
    if (entry.role === 'TAB') return true;
    return allowedUpper.has(String(entry.dinas).toUpperCase());
  });
}

module.exports = { extractMentionTokens, resolveMentionedUserIds, filterMentionsToPair };
