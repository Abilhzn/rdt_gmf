/**
 * auth — login/session (authentication) service, shared across budgeting_gmf apps (rdt, future
 * ibt). Restructured out of rdt/backend on 24 Jul 2026 so it isn't owned by one app.
 *
 * Scope is deliberately narrow: WHO is making this request (authentication), not WHAT they're
 * allowed to do (authorization) — dinas/role access rules (requireDinasAccess, requireRole,
 * blockRoles) stay in each consuming app, since those are app-specific business rules, not
 * something every future app would share the same way identity resolution is shared.
 *
 * TODO(IT-AUTH): provisional/synthetic session mechanism ONLY (see auth.routes.js). Replace once
 * GMF IT confirms their real employee/user table + platform auth (see rdt/docs/SRS.md 3.7 open
 * question) — at that point this whole service's internals change, but its HTTP contract
 * (/login, /logout, /verify) should stay the same so callers don't need to change.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { router: authRouter } = require('./auth.routes');
const { errorLoggingMiddleware } = require('./logger');

const app = express();
// Checklist 1.2 (11 Agu): baseline security headers (CSP, X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security) — this service is JSON-only (never renders its own HTML/script/style),
// so the CSP directives below are locked to 'none' as defense-in-depth rather than tuned for any
// page this service itself serves. HSTS is safe to send even before TLS is actually terminated
// (checklist 1.1) — browsers only start enforcing it once they've seen it over a real https
// response, so it's a no-op until IT finishes that, not a footgun to ship early.
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
  hsts: { maxAge: 15552000, includeSubDomains: true }, // 180 hari
}));
// Checklist 2.2 (12 Agu): every 5xx response logged to logs/error.log — see logger.js.
app.use(errorLoggingMiddleware('auth'));
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
app.use(authRouter);

// Checklist 2.2 (12 Agu): also round-trips data_user (auth's one real dependency) so "auth up but
// can't actually log anyone in because data_user is down" shows up here distinctly, instead of
// looking identical to a fully healthy auth service until someone actually tries to log in.
app.get('/health', async (req, res) => {
  const DATA_USER_URL = process.env.DATA_USER_URL || 'http://localhost:4002';
  try {
    const r = await fetch(`${DATA_USER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    res.json({ ok: true, service: 'auth', data_user: r.ok ? 'reachable' : 'unhealthy' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'auth', data_user: 'unreachable', error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 4001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`auth service listening on http://localhost:${PORT}`));
}

module.exports = { app };
