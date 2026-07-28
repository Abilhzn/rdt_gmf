const { requireUser, requireDinasAccess, requireRole } = require('../src/middleware/auth');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

// requireUser moved 24 Jul 2026: was a local directory lookup, now an HTTP call to the `auth`
// service's GET /verify — global.fetch is mocked here so this stays a fast, network-free unit
// test (live end-to-end coverage of the real auth service is a separate, deliberate gap — see
// PR notes / manual smoke test instead).
describe('requireUser (HTTP client to auth service)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  test('rejects with 401 when neither X-Session-Token nor X-User-Id is present, without calling auth service', async () => {
    global.fetch = jest.fn();
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('resolves req.rdtUser and calls next when auth service confirms the identity', async () => {
    const user = { id: 'demo-pic-tc', dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, user }) });
    const req = { headers: { 'x-user-id': 'demo-pic-tc' } };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.rdtUser).toEqual(user);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/verify'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-User-Id': 'demo-pic-tc' }) }),
    );
  });

  test('forwards X-Session-Token when present, in preference to X-User-Id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, user: { id: 'demo-tab', dinas: 'TAB', role: 'TAB', display_name: 'TAB (demo)' } }),
    });
    const req = { headers: { 'x-session-token': 'faketoken', 'x-user-id': 'demo-pic-tc' } };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Session-Token']).toBe('faketoken');
  });

  test('rejects with 401 when auth service says the identity is invalid', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, error: 'unknown user_id' }) });
    const req = { headers: { 'x-user-id': 'not-a-real-user' } };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects with 502 when the auth service is unreachable — distinct from "not authenticated"', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const req = { headers: { 'x-user-id': 'demo-pic-tc' } };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(res.statusCode).toBe(502);
    expect(next).not.toHaveBeenCalled();
  });

  test('never trusts a client-supplied dinas/role even if present on the request body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, user: { id: 'demo-pic-tc', dinas: 'TC', role: 'PIC', display_name: 'PIC TC (demo)' } }),
    });
    const req = { headers: { 'x-user-id': 'demo-pic-tc' }, body: { dinas: 'TAB', role: 'TAB' } };
    const res = mockRes();
    const next = jest.fn();
    await requireUser(req, res, next);
    expect(req.rdtUser.dinas).toBe('TC');
    expect(req.rdtUser.role).toBe('PIC');
  });
});

describe('requireDinasAccess', () => {
  const mw = requireDinasAccess('dinas');

  test('allows a PIC to access their own dinas', () => {
    const req = { rdtUser: { id: 'u1', dinas: 'TC', role: 'PIC' }, params: { dinas: 'TC' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('is case-insensitive when matching dinas codes', () => {
    const req = { rdtUser: { id: 'u1', dinas: 'tc', role: 'PIC' }, params: { dinas: 'TC' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects with 403 when a PIC tries to access a different dinas', () => {
    const req = { rdtUser: { id: 'u1', dinas: 'TC', role: 'PIC' }, params: { dinas: 'TF' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows role TAB to access any dinas', () => {
    const req = { rdtUser: { id: 'u-tab', dinas: 'TAB', role: 'TAB' }, params: { dinas: 'TF' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects with 401 when req.rdtUser was never resolved', () => {
    const req = { params: { dinas: 'TC' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  // REQ-RDT-AUTH-04: Corp has no dedicated PIC confirming day-to-day — only role TAB may act
  // as Corp on its behalf. The row itself still keeps dinas_target/dinas_inisiasi = 'Corp'
  // everywhere (label unchanged) — only who's allowed to act on it is scoped to TAB. (Role was
  // renamed from 'ADMIN_TAB' to plain 'TAB' on 24 Jul; SM_TA/GH_TA removed entirely the same
  // day, project owner correction — role TAB alone now handles everything they used to.)
  test('allows role TAB to access dinas Corp', () => {
    const req = { rdtUser: { id: 'u-tab', dinas: 'TAB', role: 'TAB' }, params: { dinas: 'Corp' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects a plain PIC from accessing dinas Corp', () => {
    const req = { rdtUser: { id: 'u1', dinas: 'TB', role: 'PIC' }, params: { dinas: 'Corp' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  test('allows a user whose role is in the allowed list', () => {
    const mw = requireRole('TAB');
    const req = { rdtUser: { id: 'u1', dinas: 'TAB', role: 'TAB' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects a PIC trying to hit a TAB-only route', () => {
    const mw = requireRole('TAB');
    const req = { rdtUser: { id: 'u1', dinas: 'TC', role: 'PIC' } };
    const res = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
