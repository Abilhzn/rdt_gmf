// TODO(IT-AUTH): interim feature-level authorization.
//
// Identity resolution (WHO is this request) lives in the shared `auth` service (GET /verify) —
// requireUser here is an HTTP client, not a local directory lookup. Dinas/role AUTHORIZATION
// (WHAT they're allowed to do — requireDinasAccess, requireRole) stays here as RDT-specific
// business rules, not shared with other apps the way identity is.
//
// This is still PROVISIONAL, not real authentication — it exists only to close the hole where any
// client can pass an arbitrary `dinas` and act as it. Once GMF IT confirms their real
// employee/user table, only the `auth` service's internals need to change — the requireUser /
// requireDinasAccess contract used by routes here should stay the same.

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';

// Resolves req.rdtUser = { id, dinas, role, display_name } by asking the `auth` service to
// verify the incoming X-Session-Token or X-User-Id header — never trusts a client-supplied
// dinas/role directly either way. Responds 401 if neither header is present/valid, or 502 if
// the auth service itself is unreachable (a real failure mode now that this is a network call,
// not a local function — distinct from "not authenticated" so it's not confused with a bad
// login attempt in logs/monitoring).
async function requireUser(req, res, next) {
  const headers = {};
  if (req.headers['x-session-token']) headers['X-Session-Token'] = req.headers['x-session-token'];
  if (req.headers['x-user-id']) headers['X-User-Id'] = req.headers['x-user-id'];
  if (!headers['X-Session-Token'] && !headers['X-User-Id']) {
    return res.status(401).json({ ok: false, error: 'X-Session-Token or X-User-Id header required' });
  }
  try {
    const verifyRes = await fetch(`${AUTH_SERVICE_URL}/verify`, { headers });
    const body = await verifyRes.json();
    if (!verifyRes.ok || !body.ok) {
      return res.status(verifyRes.status === 401 ? 401 : 502).json(body);
    }
    req.rdtUser = body.user;
    next();
  } catch (err) {
    res.status(502).json({ ok: false, error: `Gagal menghubungi auth service: ${err.message}` });
  }
}

// Middleware factory: only allow role TAB, or a user whose own dinas matches
// req.params[dinasParam] — true for a plain PIC, and equally true for TAB staff acting on dinas
// "TAB" itself. Dinas "TA" is its own operational dinas with its own PIC, and gets access here the
// same way any other PIC does, via the plain dinas-match check below.
//
// Dinas "Corp" has no dedicated PIC — only role TAB may act on its queue.
function requireDinasAccess(dinasParam) {
  return function (req, res, next) {
    const user = req.rdtUser;
    if (!user) return res.status(401).json({ ok: false, error: 'authentication required' });
    if (user.role === 'TAB') return next();
    const targetDinas = String(req.params[dinasParam] || '').toUpperCase();
    if (String(user.dinas).toUpperCase() === targetDinas) return next();
    return res.status(403).json({ ok: false, error: `user ${user.id} (dinas=${user.dinas}, role=${user.role}) not authorized for dinas=${targetDinas}` });
  };
}

// Middleware factory: only allow the named roles (e.g. ['TAB']).
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    const user = req.rdtUser;
    if (!user) return res.status(401).json({ ok: false, error: 'authentication required' });
    if (allowedRoles.includes(user.role)) return next();
    return res.status(403).json({ ok: false, error: `role ${user.role} not permitted, requires one of: ${allowedRoles.join(', ')}` });
  };
}

module.exports = {
  requireUser,
  requireDinasAccess,
  requireRole,
};
