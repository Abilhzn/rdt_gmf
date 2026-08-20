# rdt/backend

API server for RDT (Repost Detail Transaksi) — Excel parsing, the confirm/decline ledger,
reassignment, Need Approval/export batches, notifications, and everything else under `/api/*`.
Consumed by the Angular dev-shell (`../frontend/dev-shell`, port 4200) locally, and eventually by
whatever real Angular app GMF IT embeds `RdtModule` into.

**(12 Agu 2026 update — the old "demo UI at /rdt/demo" this README used to point to is gone; the
standalone `ui-demo.html` frontend was deleted 7 Agu, Angular is the only frontend now.)**

## Run it
```bash
npm install
npm test               # HARUS hijau sebelum ubah apapun — parser vs angka pivot terverifikasi
npm start              # http://localhost:4000 — perlu DATABASE_URL di .env untuk fitur DB
```
`auth` (4001) and `data_user` (4002) must already be running — every authenticated route calls
`auth`'s `/verify`.

## Health & diagnostics
- `GET /health` — round-trips the database (`SELECT 1`), distinguishes "process alive" from
  "process alive but DB unreachable".
- `logs/error.log` — every 5xx response, one JSON line each (gitignored, runtime data).
- `tools/backupDatabase.js` / `tools/restoreDatabase.js` — manual DB export/import, see
  `../docs/CHECKLIST_LAUNCH.md` section 2.1 for the full story.

## Details worth knowing
- **Non-negotiable business rules** (atomic ledger, confirm/decline semantics, audit trail,
  dinas-routing derivation) — see `../docs/SRS.md` section 3. Read before touching anything in
  `routes/confirmation.js`, `routes/reassignment.js`, or the parser.
- **Migrations**: `sql/schema.sql` (base) + `sql/migrations/*.sql` (append-only, run once each via
  `rdt._migrations_applied` tracking table — see `src/migrate.js`). Never edit an already-applied
  migration retroactively.
- Full business/architecture context, current implementation status, and requirement docs:
  `../docs/SRS.md`.
