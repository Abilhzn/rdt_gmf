Angular Integration Sample
=========================

This folder demonstrates how to integrate the RDT lazy module into an existing Angular app.

Files here are a minimal example; they are *not* a full runnable Angular CLI project — copy the patterns into your app.

Steps to integrate into your Angular app:
1. Copy the folder `budgeting_gmf/rdt/frontend/rdt` into your Angular project's `src/app/rdt`.
2. `RdtModule` imports `AuthModule` from the shared `budgeting_gmf/auth/frontend` package via the
   TypeScript path alias `@auth/*` — copy `budgeting_gmf/auth/frontend` into your project too
   (wherever makes sense for you), and add the matching alias to your `tsconfig.json`:

  "paths": { "@auth/*": ["path/to/your/copy/of/auth/frontend/*"] }

3. Add a lazy route in your app routing module:

  { path: 'rdt', loadChildren: () => import('./rdt/rdt.module').then(m => m.RdtModule) }

4. Ensure your main app proxies API calls to the RDT backend, so the component's
   fetch('/api/parse') resolves correctly. Login/session and the employee directory go through
   the SEPARATE `auth` and `data_user` services instead (not the RDT backend) — proxy
   `/auth-api/*` and `/data-api/*` to wherever you're running those (see
   `budgeting_gmf/rdt/frontend/dev-shell/proxy.conf.json` for the local dev example of all
   three prefixes together).

5. The RdtModule expects to find an API endpoint at `/api/parse` and `/api/mapping`, `/api/exclusions`, `/api/persist`.

6. Replace the placeholder TransactionService with your platform HTTP service if needed.

Example files below show the minimal wiring.
