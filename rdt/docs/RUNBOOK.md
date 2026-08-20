# Runbook — kalau ada service yang mati

Checklist 4 (12 Agu). Empat service jalan lokal: `data_user` (4002), `auth` (4001), `rdt/backend`
(4000), Angular dev-shell (4200). `start-all.bat` (root repo) start semua sekaligus; ini panduan
kalau salah satu mati di tengah jalan dan butuh restart sendiri-sendiri.

## 1. Cek yang mana yang mati

Paling cepat: `GET /health` di masing-masing (semua sekarang benar-benar ngecek dependency-nya,
bukan cuma "proses hidup" — lihat checklist 2.2):
```bash
curl http://localhost:4002/health   # data_user — directory:loaded kalau sehat
curl http://localhost:4001/health   # auth — data_user:reachable kalau sehat
curl http://localhost:4000/health   # rdt/backend — db:connected kalau sehat
curl http://localhost:4200/rdt      # dev-shell — 200 kalau sehat (bukan JSON, halaman Angular)
```
Kalau salah satu gak respons sama sekali (connection refused), proses itu udah mati. Kalau
respons tapi `ok:false`, proses HIDUP tapi dependency-nya (DB, service lain) yang bermasalah —
bukan proses ini yang perlu di-restart.

## 2. Restart satu service (Windows)

```powershell
# Cari PID yang pegang port itu
netstat -ano | findstr :4000

# Matiin
taskkill /F /T /PID <pid>

# Nyalain lagi (masing-masing di folder-nya)
cd data_user  && npm start   # 4002
cd auth       && npm start   # 4001
cd rdt\backend && npm start  # 4000
cd rdt\frontend\dev-shell && npm start  # 4200
```
Urutan start gak wajib tapi disarankan `data_user` → `auth` → `rdt/backend` → dev-shell — service
belakangan manggil yang sebelumnya, jadi paling gak lempar 502/gagal-connect di awal kalau
urutannya begini.

## 3. Kalau `rdt/backend` gagal start dengan "Migration failed, aborting start"

Database sekarang PostgreSQL lokal — cek dulu servicenya beneran jalan (`pg_isready` atau buka
pgAdmin/psql). Kalau service-nya hidup tapi tetap gagal, cek `DATABASE_URL` di
`rdt/backend/.env` masih valid (user/password/nama database `rdt_dev` cocok).

## 4. Kalau dev-shell (`ng serve`) nyala tapi kelakuannya aneh/nge-stale

`ng serve` (Vite-based) kadang nyangkut nge-serve kode lama meskipun source udah keubah dan proses
udah di-restart — kalau hard-reload browser (Ctrl+Shift+R) di tab yang lagi kebuka gak nolong,
coba: `npx ng cache clean` (di `rdt/frontend/dev-shell`) baru `npm start` lagi.

## 5. Cek error terakhir tanpa nunggu user lapor

Setiap 5xx response ke-log di `logs/error.log` (per service — `auth/logs/`, `data_user/logs/`,
`rdt/backend/logs/`), satu baris JSON per error (waktu, method, path, status, body). Gitignored,
runtime data — file ini gak ke-commit, cuma ada di mesin yang service-nya jalan.

## 6. Restore dari backup

Pakai `rdt/backend/tools/backupDatabase.js` / `tools/restoreDatabase.js` (tool sendiri, gak butuh
Docker, jalan ke database Postgres manapun lewat `DATABASE_URL`) — checklist 2.1 punya detail
lengkap + bukti udah pernah dites beneran.
