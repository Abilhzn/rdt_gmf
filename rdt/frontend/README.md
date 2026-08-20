# rdt/frontend

Angular source for RDT's UI — components/services/modules meant to be copied into GMF IT's real
Angular app (the "OCX" platform) once that integration happens. **This is not a standalone app.**

## Two things live here, don't confuse them
- **`rdt/`** — the actual source (`RdtModule` and everything it declares/imports). This is what
  eventually ships. Edit files here for any real feature work.
- **`dev-shell/`** — local-only Angular CLI workspace whose sole job is `ng serve`-ing `RdtModule`
  in a real browser during development (`npm start`, http://localhost:4200/rdt). Disposable
  scaffolding, not part of the integration path — see `dev-shell/README.md`.

`angular-integration-sample/README.md` documents the actual manual-copy-paste integration path for
GMF IT's team — separate from both of the above.

## Run it locally
```bash
cd dev-shell
npm install
npm start   # http://localhost:4200/rdt — proxies /api, /auth-api, /data-api to the 3 backend
             # services (ports 4000/4001/4002), which must already be running
```

## Details worth knowing
- **Auth pieces live in `../../auth/frontend/`**, not here — `Login`/`SelectPlatform`/
  `CurrentUserService` are shared across every app under this repo, not RDT-specific.
- **Security headers**: `dev-shell/angular.json`'s `serve.headers` sets a dev-only CSP/
  `X-Frame-Options`/`X-Content-Type-Options` — see `dev-shell/README.md`'s own section on why
  it's deliberately looser than the backend services' and not representative of production.
- Full business/architecture context: `../docs/SRS.md`.
