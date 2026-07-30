const { extractMentionTokens, resolveMentionedUserIds } = require('../src/rules/mentionRules');

const directory = {
  'demo-pic-tc': { dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' },
  'demo-pic-tj': { dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' },
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

  // REQ-RDT-COMMENT-04 (31 Jul): "TA" was retired and merged into "TAB" — no directory entry has
  // dinas='TA', so @TA must alias to TAB instead of silently resolving to nobody.
  test('@TA aliases to dinas TAB', () => {
    expect(resolveMentionedUserIds('cc @TA tolong cek', directory)).toEqual(['demo-tab']);
  });

  test('@TA alias is case-insensitive', () => {
    expect(resolveMentionedUserIds('cc @ta tolong cek', directory)).toEqual(['demo-tab']);
  });
});
