import { deriveStateLabel } from './state-label';

describe('deriveStateLabel (REQ-RDT-SAP-07)', () => {
  test('pending rows -> Waiting for confirmation [target]', () => {
    expect(
      deriveStateLabel({
        pendingCount: 2,
        targetDinas: 'TM',
        subdocNumbers: [],
      }),
    ).toBe('Waiting for confirmation TM');
  });

  test('resolved, no subdocs -> Waiting to repost', () => {
    expect(
      deriveStateLabel({
        pendingCount: 0,
        targetDinas: 'TM',
        subdocNumbers: [],
      }),
    ).toBe('Waiting to repost');
  });

  test('resolved, subdocs undefined -> Waiting to repost', () => {
    expect(deriveStateLabel({ pendingCount: 0, targetDinas: 'TM' })).toBe(
      'Waiting to repost',
    );
  });

  test('resolved with subdocs -> Reposted by TAB with subdoc [...]', () => {
    expect(
      deriveStateLabel({
        pendingCount: 0,
        targetDinas: 'TM',
        subdocNumbers: ['SD-001'],
      }),
    ).toBe('Reposted by TAB with subdoc SD-001');
  });

  test('multiple subdocs joined', () => {
    expect(
      deriveStateLabel({
        pendingCount: 0,
        targetDinas: 'TM',
        subdocNumbers: ['SD-001', 'SD-002'],
      }),
    ).toBe('Reposted by TAB with subdoc SD-001, SD-002');
  });

  test('pending takes priority even if subdocs somehow present', () => {
    expect(
      deriveStateLabel({
        pendingCount: 1,
        targetDinas: 'TM',
        subdocNumbers: ['SD-001'],
      }),
    ).toBe('Waiting for confirmation TM');
  });
});
