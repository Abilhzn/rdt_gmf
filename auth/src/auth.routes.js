const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
const sessions = new Map(); // token -> { id, dinas, role, display_name }

// Exported separately (not inlined in the route handler) so it's unit-testable without going
// through Express req/res. Async since 24 Jul's service split — the employee directory now
// lives in the data_user service, not a local file.
async function verifyCredentials(username, password) {
  if (!username || !password) return null;
  const credentials = loadJSON('credentials.seed.json');
  const expected = credentials[username];
  if (!expected || expected !== password) return null;
  const entry = await getEmployee(username);
  if (!entry) return null;
  return { id: username, dinas: entry.dinas, role: entry.role, display_name: entry.display_name };
}

router.post('/login', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = await verifyCredentials(username, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Username atau password salah' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user);
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
router.get('/verify', async (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (sessionToken) {
    const session = sessions.get(sessionToken);
    if (!session) return res.status(401).json({ ok: false, error: 'invalid or expired session token' });
    return res.json({ ok: true, user: session });
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

module.exports = { router, sessions, verifyCredentials };
