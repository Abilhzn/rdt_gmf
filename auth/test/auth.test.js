// Restructured 24 Jul 2026: requireUser/requireDinasAccess/requireRole/blockRoles moved to
// rdt/backend (see rdt/backend/test/authorization.test.js) — this file now only covers what
// actually stayed in the auth service: credential verification and the session store.
const { sessions, verifyCredentials } = require('../src/auth.routes');
const dataUserClient = require('../src/dataUserClient');

jest.mock('../src/dataUserClient');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

// REQ-RDT-NAV-08: synthetic username+password login gating the same provisional identity model
// the `auth` service resolves — verifyCredentials() is the pure logic behind POST /login.
// data_user is mocked here (jest.mock above) so this stays a fast, network-free unit test.
describe('verifyCredentials', () => {
  afterEach(() => { jest.clearAllMocks(); });

  test('resolves a known user_id + correct password', async () => {
    dataUserClient.getEmployee.mockResolvedValue({ dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' });
    await expect(verifyCredentials('demo-tc', 'tc123')).resolves.toEqual({
      id: 'demo-tc', dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)',
    });
  });

  test('rejects a wrong password for a real user_id, without even calling data_user', async () => {
    await expect(verifyCredentials('demo-tc', 'wrong')).resolves.toBeNull();
    expect(dataUserClient.getEmployee).not.toHaveBeenCalled();
  });

  test('rejects an unknown username', async () => {
    await expect(verifyCredentials('not-a-real-user', 'whatever')).resolves.toBeNull();
  });

  test('rejects missing username or password', async () => {
    await expect(verifyCredentials('', 'tc123')).resolves.toBeNull();
    await expect(verifyCredentials('demo-tc', '')).resolves.toBeNull();
  });

  test('rejects when the password matches but data_user has no matching employee (inconsistent state)', async () => {
    dataUserClient.getEmployee.mockResolvedValue(null);
    await expect(verifyCredentials('demo-tc', 'tc123')).resolves.toBeNull();
  });
});

// Session store contract that GET /verify (auth.routes.js) relies on — see
// rdt/backend/test/authorization.test.js's requireUser tests for the HTTP-client side of this.
describe('sessions', () => {
  afterEach(() => { sessions.clear(); });

  test('holds whatever user object it was given, keyed by token', () => {
    const user = { id: 'demo-tj', dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' };
    sessions.set('faketoken123', user);
    expect(sessions.get('faketoken123')).toEqual(user);
  });

  test('returns undefined for an unknown token', () => {
    expect(sessions.get('not-a-real-token')).toBeUndefined();
  });
});
