# Struktur rdt/ — baca ini dulu sebelum mengubah frontend

**Restrukturisasi 24 Jul 2026**: `rdt/` sekarang salah satu app di bawah
root repo yang sama sebagai `auth/` dan `data_user/` (service bersama,
dipakai app lain juga nantinya). Login/Select
Platform + `current-user.service.ts` sudah pindah ke `../auth/frontend/`,
bukan di `frontend/rdt/` lagi.

**7 Agu 2026**: `ui-demo.html` (frontend vanilla HTML/JS kedua yang dulu
di-serve backend di `localhost:4000`) sudah **dihapus**. Angular adalah
satu-satunya frontend sekarang — gak ada lagi kewajiban sinkronisasi dua
sisi. Semua trial-and-test langsung di Angular dev-shell.

## `frontend/rdt/` — SOURCE ANGULAR UNTUK INTEGRASI NANTI
Module Angular (component, service, model, guard, routing) yang TIDAK bisa
jalan standalone dengan sendirinya — tidak ada Angular workspace
(angular.json, main.ts) di folder ini sendiri, dan itu disengaja: file-file
ini nanti ditempel ke repo Angular platform OCX milik tim IT sebagai lazy
module `/rdt`. Untuk uji coba LOKAL, pakai `frontend/dev-shell/` (Angular
CLI workspace beneran, `ng serve`, lihat section di bawah) — itu
me-link folder ini via NTFS junction, bukan copy.

Auth-related pieces (Login, Select Platform, `current-user.service.ts`)
SUDAH TIDAK ADA di sini — itu di `../auth/frontend/` (`AuthModule`,
service bersama lintas-app). `rdt.module.ts` meng-import `AuthModule`
lewat TypeScript path alias `@auth/*` (lihat `frontend/dev-shell/
tsconfig.app.json`) — siapapun yang integrasikan module `rdt/` ini ke app
Angular lain WAJIB menyediakan alias yang sama, menunjuk ke lokasi
`auth/frontend/` mereka.

## Kontrak API
Sama untuk backend: `POST /api/parse`, `POST /api/persist`, `GET/PUT
/api/mapping`, `GET/PUT /api/exclusions` (lihat `backend/src/index.js`).
Login/session lewat `auth` service terpisah (`/auth-api/*`), directory
employee lewat `data_user` service (`/data-api/*`).

## Menjalankan

Backend RDT butuh `auth` dan `data_user` service jalan juga (port 4001 dan
4002) supaya fitur login/directory berfungsi:

```bash
cd auth && npm install && npm start        # port 4001
cd data_user && npm install && npm start   # port 4002
cd rdt/backend && npm install && npm start # port 4000, API only, tidak serve UI apapun
npm test           # test parser vs angka pivot terverifikasi (SRS #8)
```

Angular dev-shell (satu-satunya cara uji coba interaktif):
```bash
cd rdt/frontend/dev-shell
npm install
ng serve            # buka http://localhost:4200/rdt — proxy ke ketiga service di atas
```
