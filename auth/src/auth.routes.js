const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { getEmployee } = require('./dataUserClient');

const router = express.Router();

function loadJSON(name) {
  const p = path.join(__dirname, name);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete raw._comment;
  return raw;
}

// TODO(IT-AUTH): provisional session store for REQ-RDT-NAV-08's synthetic Login page — an
// in-memory Map, not a real session mechanism. Cleared whenever the server restarts (everyone
// has to log in again) and never persisted anywhere. Once GMF IT's real employee/user table +
// platform auth is wired in (rdt/docs/SRS.md 3.7 open question), this whole file gets replaced,
// not just its data source swapped.
//
// Checklist 1.2 (11 Agu): token used to live forever (no expiry field at all) — a leaked/stolen
// token stayed valid until the whole server restarted. Each entry is now { user, expiresAt }
// instead of the bare user object; SESSION_TTL_MS default 8 hours (one work shift), configurable
// via SESSION_TTL_HOURS so this doesn't need a code change to retune later.
const sessions = new Map(); // token -> { user: {id, dinas, role, display_name}, expiresAt: number }
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_HOURS) || 8) * 60 * 60 * 1000;

// Exported separately (not inlined in the route handler) so it's unit-testable without going
// through Express req/res. Async since 24 Jul's service split — the employee directory now
// lives in the data_user service, not a local file.
async function verifyCredentials(username, password) {
  if (!username || !password) return null;
  let credentials = loadJSON('credentials.seed.json');
  // Handoff builds ship credentials.seed.json redacted (no entries) — fall back to generating
  // the same synthetic scheme in memory instead of requiring it to be regenerated on disk first.
  if (Object.keys(credentials).length === 0) credentials = require('../tools/generateCredentials').build();
  const expected = credentials[username];
  if (!expected || expected !== password) return null;
  const entry = await getEmployee(username);
  if (!entry) return null;
  return { id: username, dinas: entry.dinas, role: entry.role, display_name: entry.display_name };
}

// Checklist 1.2 (11 Agu): brute-force protection on the one endpoint that actually checks a
// password. Keyed by IP (express-rate-limit's default keyGenerator) — 5 FAILED attempts per
// 15-minute window, then 429 until the window rolls over. skipSuccessfulRequests=true so a
// legitimate user who mistypes once or twice, then gets it right, never gets locked out by
// their own successful login; only a run of failures counts against the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Terlalu banyak percobaan login gagal dari alamat ini. Coba lagi dalam beberapa menit.',
      code: 'RATE_LIMITED',
    });
  },
});

router.post('/login', loginLimiter, express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = await verifyCredentials(username, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Username atau password salah' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Gagal menghubungi data_user service: ${err.message}` });
  }
});

router.post('/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// GET /verify — replaces the old LOCAL requireUser middleware (moved out of rdt/backend 24 Jul,
// see rdt/backend/src/middleware/auth.js): resolves an identity from X-Session-Token (checked
// first) or X-User-Id, the same contract every consuming app's middleware calls over HTTP now
// instead of requiring this file directly. Never trusts a client-supplied dinas/role — always
// resolved server-side either from the session store or via data_user.
//
// Checklist 1.2 (11 Agu): an expired token and a token that never existed now get DISTINCT error
// codes/messages — a caller needs to tell "please log in again, your session ended" apart from
// "that token is nonsense" for a clear user-facing message instead of one generic 401.
router.get('/verify', async (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (sessionToken) {
    const session = sessions.get(sessionToken);
    if (!session) return res.status(401).json({ ok: false, error: 'Sesi tidak valid', code: 'INVALID_SESSION' });
    if (Date.now() > session.expiresAt) {
      sessions.delete(sessionToken);
      return res.status(401).json({ ok: false, error: 'Session sudah kedaluwarsa, silakan login ulang', code: 'SESSION_EXPIRED' });
    }
    return res.json({ ok: true, user: session.user });
  }
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ ok: false, error: 'X-Session-Token or X-User-Id header required' });
  try {
    const entry = await getEmployee(userId);
    if (!entry) return res.status(401).json({ ok: false, error: 'unknown user_id' });
    res.json({ ok: true, user: Object.assign({ id: userId }, entry) });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Gagal menghubungi data_user service: ${err.message}` });
  }
});

module.exports = { router, sessions, verifyCredentials, SESSION_TTL_MS };
