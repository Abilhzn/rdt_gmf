# dev-shell

Local-only Angular CLI workspace whose sole job is to `ng serve` the real
`RdtModule` at `../rdt` so it can be clicked through in a browser during
development. Generated with Angular CLI 22.0.7 (matches installed Node
v24.18.0).

**This is not the integration path.** Nothing here gets handed to the IT
team — that's still `../angular-integration-sample/README.md` (manual
copy-paste into their app). This workspace is disposable scaffolding.

`src/app/rdt` is an **NTFS junction**, not a copy, pointing at
`src/frontend/rdt`. Editing files there (in either location — they're the
same files on disk) is picked up by `ng serve`'s live reload immediately.
It's excluded from this workspace's git tracking (`.gitignore`) so RDT's
source isn't tracked twice under two paths.

## Run it

Backend must already be running (`cd ../../backend && npm start`, port
4000). Then:

```bash
npm install   # first time only
npm start     # ng serve, http://localhost:4200 -> redirects to /rdt
```

`proxy.conf.json` forwards `/api/*` calls to `http://localhost:4000`, so
upload/parse/confirm actually hit the real backend instead of 404ing.

## Security headers (checklist 1.2, 11 Agu)

`angular.json`'s `serve.options.headers` sets a CSP/`X-Frame-Options`/
`X-Content-Type-Options` on every response from this dev server —
**dev-only**, deliberately looser than the 3 backend services' CSP (helmet
locks theirs to `'none'` everywhere, since those are pure JSON APIs).
`'unsafe-eval'`/`'unsafe-inline'` here are dev-server realities (Vite/esbuild
HMR transforms, Angular's un-nonced inline component styles), not something
to copy into production as-is. This ISN'T what production gets anyway — RDT
isn't a standalone app, it's embedded into GMF's OCX platform in production
(see `rdt/CLAUDE.md` section 2), which owns its own server/headers; this
config only covers local `ng serve` testing.
