# auth

Login/session service, shared across every app under this repo (`rdt`, future `ibt`) — not owned
by any one of them. Provisional/synthetic (`TODO(IT-AUTH)`, see `src/index.js`) until GMF IT
confirms the real employee/user table.

## What it does
- `POST /login` — username+password (checked against `credentials.seed.json` + the `data_user`
  service) → opaque session token, valid 8 hours (`SESSION_TTL_HOURS` env, default 8).
- `GET /verify` — resolves a token (or `X-User-Id`, a header-only bypass every consuming app's
  middleware also accepts) to `{id, dinas, role, display_name}`.
- `POST /logout` — drops the token server-side.
- `GET /health` — also round-trips `data_user` (its one real dependency).

## Run it
```bash
npm install
npm start           # http://localhost:4001
npm test             # jest — 13 tests, session/rate-limit/expiry behavior
```
`data_user` (port 4002) must already be running — this service calls it for every login.

## Details worth knowing
- **Session store is in-memory only** — restarting this process logs everyone out. Deliberate for
  now (see `auth.routes.js`'s header comment), not a bug.
- **Rate limiting**: `POST /login` allows 5 failed attempts per IP per 15 minutes
  (`express-rate-limit`), successful logins don't count against it.
- **`INTERNAL_SERVICE_KEY`** (optional env var): if set, sent as `X-Internal-Key` to `data_user`
  — see `data_user/README.md` for what it protects.
- Full business/architecture context: `../rdt/docs/SRS.md` and `../rdt/docs/IRS.md`.
