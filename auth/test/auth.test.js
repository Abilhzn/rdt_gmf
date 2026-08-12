// Restructured 24 Jul 2026: requireUser/requireDinasAccess/requireRole/blockRoles moved to
// rdt/backend (see rdt/backend/test/authorization.test.js) — this file now only covers what
// actually stayed in the auth service: credential verification and the session store.
const request = require('supertest');
const { sessions, verifyCredentials, SESSION_TTL_MS } = require('../src/auth.routes');
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

// Checklist 1.2 (11 Agu): session store contract used by GET /verify. Shape changed from a bare
// user object to { user, expiresAt } — see rdt/backend/test/authorization.test.js's requireUser
// tests for the HTTP-client side of this (unaffected, it only ever sees GET /verify's JSON body,
// never the store's internal shape directly).
describe('sessions', () => {
  afterEach(() => { sessions.clear(); });

  test('holds { user, expiresAt }, keyed by token', () => {
    const user = { id: 'demo-tj', dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' };
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set('faketoken123', { user, expiresAt });
    expect(sessions.get('faketoken123')).toEqual({ user, expiresAt });
  });

  test('returns undefined for an unknown token', () => {
    expect(sessions.get('not-a-real-token')).toBeUndefined();
  });

  test('SESSION_TTL_MS defaults to 8 hours', () => {
    expect(SESSION_TTL_MS).toBe(8 * 60 * 60 * 1000);
  });
});

// Checklist 1.2 (11 Agu): GET /verify's expiry handling, via supertest against the real Express
// app (not the pure sessions Map directly) — this is what an expired-token caller actually sees.
describe('GET /verify — session expiry', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('../src/index'));
  });

  afterEach(() => { jest.clearAllMocks(); });

  test('an expired token is rejected with a distinct SESSION_EXPIRED code, not a generic 401', async () => {
    const { sessions: freshSessions } = require('../src/auth.routes');
    const user = { id: 'demo-tj', dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' };
    freshSessions.set('expired-token', { user, expiresAt: Date.now() - 1000 }); // already in the past

    const res = await request(app).get('/verify').set('X-Session-Token', 'expired-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    // The expired entry is also cleaned up, not left dangling in the store.
    expect(freshSessions.has('expired-token')).toBe(false);
  });

  test('a token that was never issued gets a different code (INVALID_SESSION)', async () => {
    const res = await request(app).get('/verify').set('X-Session-Token', 'never-issued');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SESSION');
  });

  test('a token still within its TTL is accepted', async () => {
    const { sessions: freshSessions, SESSION_TTL_MS: ttl } = require('../src/auth.routes');
    const user = { id: 'demo-tj', dinas: 'TJ', role: 'PIC', display_name: 'PIC TJ (demo)' };
    freshSessions.set('still-valid', { user, expiresAt: Date.now() + ttl });

    const res = await request(app).get('/verify').set('X-Session-Token', 'still-valid');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(user);
  });
});

// Checklist 1.2 (11 Agu): brute-force protection on POST /login. Each test gets its own fresh
// app/module instance (jest.resetModules) so the rate limiter's in-memory per-IP counter never
// leaks between test cases — supertest requests all originate from the same loopback address,
// so without isolation, an earlier test's failed attempts would count against a later one.
describe('POST /login — rate limiting', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('../src/index'));
  });

  afterEach(() => { jest.clearAllMocks(); });

  test('the 6th failed attempt in a row gets 429, not another 401', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/login').send({ username: 'demo-tc', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const sixth = await request(app).post('/login').send({ username: 'demo-tc', password: 'wrong' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
  });

  test('a successful login does not count against the limit — 4 failures then a success then more failures still fit', async () => {
    const dataUserClientMock = require('../src/dataUserClient');
    dataUserClientMock.getEmployee.mockResolvedValue({ dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' });

    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/login').send({ username: 'demo-tc', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    // Correct credentials — success, and per skipSuccessfulRequests, doesn't consume a slot.
    const success = await request(app).post('/login').send({ username: 'demo-tc', password: 'tc123' });
    expect(success.status).toBe(200);
    expect(success.body.ok).toBe(true);

    // Still only 4 failures counted so far — one more failed attempt should still be allowed
    // (5th), proving the successful request in between wasn't counted.
    const fifthFailure = await request(app).post('/login').send({ username: 'demo-tc', password: 'wrong' });
    expect(fifthFailure.status).toBe(401);
  });
});
