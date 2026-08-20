# data_user

Employee/user directory service, shared across every app under this repo (`rdt`, future `ibt`).
Provisional/synthetic (`TODO(IT-AUTH)`, `employee-directory.seed.json`) until GMF IT confirms the
real employee/user table (see `../rdt/docs/SRS.md` section 3.7).

## What it does
- `GET /employees` — full directory (used for @mention autocomplete, comment/notification author
  names).
- `GET /employees/:id` — single lookup, 404 if unknown (used by `auth` during login).
- `GET /health` — also verifies the seed file actually loads.

## Run it
```bash
npm install
npm start   # http://localhost:4002
```
No `npm test` yet — this service is thin enough (two read-only lookups over a static JSON file)
that it hasn't needed one; see `auth/test/auth.test.js` for coverage of the one place its output
actually gets consumed and validated.

## Details worth knowing
- **This is a service-to-service boundary** — `auth` and `rdt/backend` call it directly, no
  end-user's browser ever talks to it. Because of that, it doesn't use the session-token auth
  every other endpoint in this repo does; instead, set `INTERNAL_SERVICE_KEY` (same value on this
  service and on `auth`/`rdt/backend`) to require an `X-Internal-Key` header on `/employees*`.
  **Unset by default** (fine for local dev, prints a startup warning) — set it once this service
  is reachable from anywhere beyond `localhost`.
- Full business/architecture context: `../rdt/docs/SRS.md` and `../rdt/docs/IRS.md`.
