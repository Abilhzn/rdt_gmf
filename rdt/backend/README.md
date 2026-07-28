RDT Backend demo
=================

This folder contains a minimal demo backend exposing an Excel parser used by the RDT module.

How to run (local demo):
1. Also start the `auth` and `data_user` services first (ports 4001/4002) — this backend calls
   them for login/session verification and the employee directory, see `../CLAUDE.md`.
2. Install dependencies: `npm install --prefix budgeting_gmf/rdt/backend`
3. Start server: `node budgeting_gmf/rdt/backend/src/index.js`
4. Open demo UI: http://localhost:4000/rdt/demo and upload `budgeting_gmf/rdt/contoh_input/06. DT TB - Jun 2026.xlsx`

Notes:
- The demo is intentionally simple. Production must integrate parser into the team's backend with proper auth and persistence.
- Parser implementation lives in `src/parser/excelParser.js` and is documented there.
