# Runbook — kalau ada service yang mati

Checklist 4 (12 Agu). Empat service jalan lokal: `data_user` (4002), `auth` (4001), `rdt/backend`
(3000), Angular dev-shell (4200). `start-all.bat` (root repo) start semua sekaligus; ini panduan
kalau salah satu mati di tengah jalan dan butuh restart sendiri-sendiri.

## 1. Cek yang mana yang mati

Paling cepat: `GET /health` di masing-masing (semua sekarang benar-benar ngecek dependency-nya,
bukan cuma "proses hidup" — lihat checklist 2.2):
```bash
curl http://localhost:4002/health   # data_user — directory:loaded kalau sehat
curl http://localhost:4001/health   # auth — data_user:reachable kalau sehat
curl http://localhost:3000/health   # rdt/backend — { status:'ok', db:'ok' } kalau sehat
curl http://localhost:4200/rdt      # dev-shell — 200 kalau sehat (bukan JSON, halaman Angular)
```
Kalau salah satu gak respons sama sekali (connection refused), proses itu udah mati. Kalau
respons tapi `db:'unreachable'`/`ok:false`, proses HIDUP tapi dependency-nya (DB, service lain)
yang bermasalah — bukan proses ini yang perlu di-restart. `rdt/backend`'s `/health` sendiri
selalu balas HTTP 200 (`status:'ok'` di level app) — cek field `db` di body-nya, bukan status code,
buat tau DB-nya konek atau enggak.

## 2. Restart satu service (Windows)

```powershell
# Cari PID yang pegang port itu
netstat -ano | findstr :3000

# Matiin
taskkill /F /T /PID <pid>

# Nyalain lagi (masing-masing di folder-nya)
cd data_user  && npm start   # 4002
cd auth       && npm start   # 4001
cd rdt\backend && npm run start   # 3000
cd rdt\frontend\dev-shell && npm start  # 4200
```
Urutan start gak wajib tapi disarankan `data_user` → `auth` → `rdt/backend` → dev-shell —
service belakangan manggil yang sebelumnya, jadi paling gak lempar 502/gagal-connect di awal kalau
urutannya begini.

## 3. Kalau `rdt/backend` gagal start / connect DB error

Database sekarang PostgreSQL lokal — cek dulu servicenya beneran jalan (`pg_isready` atau buka
pgAdmin/psql). Kalau service-nya hidup tapi tetap gagal, cek `DB_HOST`/`DB_PORT`/`DB_NAME`/
`DB_USER`/`DB_PASSWORD` di `rdt/backend/.env` masih valid (nama database default `rdt`,
lihat `.env.example`). Beda dari backend Express lama: NestJS TIDAK jalanin migration otomatis
pas start (gak ada lagi "Migration failed, aborting start") — migration harus dijalanin manual
lewat `npm run migrate` (lihat section 6a) SEBELUM `npm start`/`npm run start:dev`, kalau skema
belum ada `app` bakal jalan tapi query pertama ke tabel yang belum ada bakal gagal.

## 4. Kalau dev-shell (`ng serve`) nyala tapi kelakuannya aneh/nge-stale

`ng serve` (Vite-based) kadang nyangkut nge-serve kode lama meskipun source udah keubah dan proses
udah di-restart — kalau hard-reload browser (Ctrl+Shift+R) di tab yang lagi kebuka gak nolong,
coba: `npx ng cache clean` (di `rdt/frontend/dev-shell`) baru `npm start` lagi.

## 5. Cek error terakhir tanpa nunggu user lapor

`rdt/backend` punya `logs/error.log` (gitignored, sama treatment-nya kayak `auth`/`data_user`) —
tiap response 5xx (lewat `GlobalExceptionFilter`, `rdt/backend/src/core/exception/
global-exception.filter.ts`, ditulis via `error-log.util.ts`) ke-append satu baris JSON ke situ,
gak cuma dibentuk jadi response JSON `{statusCode, message, error}` doang. `auth`/`data_user`
(masih Express) punya `logs/error.log` masing-masing dengan pola yang sama.

## 6. Restore dari backup

**Gap**: `rdt/backend` belum punya tool backup/restore sendiri (`backupDatabase.js`/
`restoreDatabase.js` ada di backend Express lama, dihapus 27 Agu 2026 bareng foldernya, belum
di-port). Sampai ada penggantinya, restore manual pakai `pg_dump`/`pg_restore` standar ke
`DATABASE_URL`/`DB_*` yang sama dengan `rdt/backend/.env` — checklist 2.1 (`CHECKLIST_LAUNCH.md`)
punya konteks kenapa
tool lama itu dibuat dan sudah pernah dites, tapi tool-nya sendiri tidak lagi ada di repo ini.

### 6a. Migration (schema, bukan restore data)

`cd rdt/backend && npm run migrate` — jalanin `schema.sql` lalu `sql/migrations/*.sql`
berurutan (idempoten, tracking di tabel `rdt._migrations_applied`). Ini gantiin migration
otomatis-saat-start yang dulu ada di backend Express lama.
