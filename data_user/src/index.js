/**
 * data_user — employee/user directory service, shared across budgeting_gmf apps (rdt, future
 * ibt). Restructured out of rdt/backend on 24 Jul 2026 so it isn't owned by one app.
 *
 * TODO(IT-AUTH): provisional/synthetic directory ONLY (employee-directory.seed.json). Replace
 * with a lookup against GMF IT's real employee/user table once its name and schema are
 * confirmed (see rdt/docs/SRS.md section 3.7 Open Question) — at that point this file's data
 * source changes, but callers (auth service, rdt/backend) keep using the same HTTP contract.
 */
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { errorLoggingMiddleware } = require('./logger');

function loadDirectory() {
  const p = path.join(__dirname, '..', 'employee-directory.seed.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete raw._comment;
  return raw;
}

const app = express();
// Checklist 1.2 (11 Agu): baseline security headers — JSON-only service, same 'none' CSP
// rationale as auth/src/index.js (see its comment for why).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY — matches frameAncestors 'none' above
  hsts: { maxAge: 15552000, includeSubDomains: true },
}));
// Checklist 2.2 (12 Agu): every 5xx response logged to logs/error.log — see logger.js.
app.use(errorLoggingMiddleware('data_user'));
// Checklist 2.2 (12 Agu): bounds every request to SOME response instead of hanging forever —
// see rdt/backend/src/index.js's own copy of this middleware for the full rationale.
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ ok: false, error: 'Request timeout — server tidak merespons dalam 30 detik. Coba lagi.', code: 'REQUEST_TIMEOUT' });
      res.json = () => res;
      res.end = () => res;
    }
  }, 30000);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});
app.use(cors());

// Checklist 2.2 (12 Agu): also verifies the seed file actually loads (the one real thing that
// can break here) rather than just "process is alive".
app.get('/health', (req, res) => {
  try {
    loadDirectory();
    res.json({ ok: true, service: 'data_user', directory: 'loaded' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'data_user', directory: 'error', error: String(err.message || err) });
  }
});

// Checklist 1.1 (12 Agu): this service had ZERO auth of any kind — anyone who could reach port
// 4002 directly (not just through auth/rdt-backend) could dump the whole employee directory.
// This is a service-to-service boundary (auth + rdt/backend call it, no end-user ever hits it
// directly), so a per-USER token doesn't fit — a shared internal key does, checked here and sent
// by both callers' dataUserClient.js. INTERNAL_SERVICE_KEY unset = unenforced (matches this
// project's existing "provisional, warn once, don't hard-fail local dev" pattern, e.g.
// migrate.js's `DATABASE_URL not set — skipping`) — set it once real network exposure exists.
if (!process.env.INTERNAL_SERVICE_KEY) {
  console.warn('WARNING: INTERNAL_SERVICE_KEY not set — /employees* endpoints are unauthenticated. Fine for local dev, NOT fine once this service is network-reachable beyond localhost.');
}
function requireInternalKey(req, res, next) {
  if (!process.env.INTERNAL_SERVICE_KEY) return next();
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ ok: false, error: 'X-Internal-Key header required/invalid' });
  }
  next();
}

// GET /employees — full directory (mirrors rdt/backend's old GET /api/directory). Used by:
// auth service (credential verification), rdt/backend (comment author names, @mention
// resolution, notification display names).
app.get('/employees', requireInternalKey, (req, res) => {
  try {
    res.json({ ok: true, employees: loadDirectory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /employees/:id — single lookup, 404 if unknown. Used by auth service during login.
app.get('/employees/:id', requireInternalKey, (req, res) => {
  try {
    const directory = loadDirectory();
    const entry = directory[req.params.id];
    if (!entry) return res.status(404).json({ ok: false, error: 'unknown user_id' });
    res.json({ ok: true, id: req.params.id, employee: entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 4002;
if (require.main === module) {
  app.listen(PORT, () => console.log(`data_user service listening on http://localhost:${PORT}`));
}

module.exports = { app };
