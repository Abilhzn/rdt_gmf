const { extractMentionTokens, resolveMentionedUserIds, filterMentionsToPair } = require('../src/rules/mentionRules');

const directory = {
  'demo-pic-tc': { dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' },
  'demo-pic-tj': { dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' },
  'demo-ta': { dinas: 'TA', role: 'PIC', display_name: 'TA (demo)' },
  'demo-tmm': { dinas: 'TMM', role: 'PIC', display_name: 'TMM (demo)' },
  'demo-tab': { dinas: 'TAB', role: 'TAB', display_name: 'TAB (demo)' },
};

describe('extractMentionTokens', () => {
  test('extracts multiple distinct mentions from a message', () => {
    expect(extractMentionTokens('cc @demo-pic-tj dan @TC tolong cek')).toEqual(['demo-pic-tj', 'TC']);
  });

  test('deduplicates repeated mentions', () => {
    expect(extractMentionTokens('@TC @TC lagi @TC')).toEqual(['TC']);
  });

  test('returns empty array when there is no mention', () => {
    expect(extractMentionTokens('tidak ada mention di sini')).toEqual([]);
  });

  test('handles null/undefined body gracefully', () => {
    expect(extractMentionTokens(null)).toEqual([]);
    expect(extractMentionTokens(undefined)).toEqual([]);
  });
});

describe('resolveMentionedUserIds', () => {
  test('resolves a direct user_id mention', () => {
    expect(resolveMentionedUserIds('cc @demo-pic-tj', directory)).toEqual(['demo-pic-tj']);
  });

  test('resolves a dinas-code mention to every user in that dinas', () => {
    expect(resolveMentionedUserIds('cc @TJ', directory)).toEqual(['demo-pic-tj']);
  });

  test('dinas-code mention is case-insensitive', () => {
    expect(resolveMentionedUserIds('cc @tj', directory)).toEqual(['demo-pic-tj']);
  });

  test('ignores a mention that matches neither a user_id nor a dinas code', () => {
    expect(resolveMentionedUserIds('cc @nonexistent', directory)).toEqual([]);
  });

  test('does not duplicate a user reachable via both a direct mention and their dinas', () => {
    expect(resolveMentionedUserIds('@demo-pic-tj @TJ', directory)).toEqual(['demo-pic-tj']);
  });

  // REQ-RDT-AUTH-05 (corrected 31 Jul): "TA" is its own operational dinas with its own PIC, NOT
  // a synonym for "TAB" — @TA must resolve to the TA PIC, not TAB (a same-day 24 Jul-era alias
  // that briefly did the opposite has been removed, see mentionRules.js).
  test('@TA resolves to dinas TA\'s own PIC, not TAB', () => {
    expect(resolveMentionedUserIds('cc @TA tolong cek', directory)).toEqual(['demo-ta']);
  });

  test('@TA resolution is case-insensitive', () => {
    expect(resolveMentionedUserIds('cc @ta tolong cek', directory)).toEqual(['demo-ta']);
  });
});

// Privacy bug (3 Agu, still leaking 4 Agu): a broadcast description mentioning multiple dinas at
// once (e.g. a Repost upload touching both TJ->TA and TJ->TMM, description "@TA @TMM tolong
// konfirmasi") must NOT let TA's PIC see the TJ->TMM comment (or vice versa) just because both
// were named in the same shared text — see mentionRules.js's header comment on this function.
describe('filterMentionsToPair', () => {
  test('drops a mentioned user whose dinas is not part of the pair', () => {
    const mentioned = resolveMentionedUserIds('@TA @TMM tolong konfirmasi', directory);
    expect(mentioned.sort()).toEqual(['demo-ta', 'demo-tmm']);
    // this comment is anchored to the TJ->TA pair specifically
    expect(filterMentionsToPair(mentioned, directory, ['TJ', 'TA'])).toEqual(['demo-ta']);
  });

  test('keeps a mentioned user whose dinas IS part of the pair', () => {
    const mentioned = resolveMentionedUserIds('@TA @TMM tolong konfirmasi', directory);
    expect(filterMentionsToPair(mentioned, directory, ['TJ', 'TMM'])).toEqual(['demo-tmm']);
  });

  test('always keeps a TAB-role user regardless of pair', () => {
    const mentioned = resolveMentionedUserIds('@TAB tolong cek', directory);
    expect(filterMentionsToPair(mentioned, directory, ['TJ', 'TA'])).toEqual(['demo-tab']);
  });

  test('drops an id with no matching directory entry', () => {
    expect(filterMentionsToPair(['ghost-user'], directory, ['TJ', 'TA'])).toEqual([]);
  });
});
