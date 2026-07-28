# Struktur rdt/ — baca ini dulu sebelum mengubah frontend

**Restrukturisasi 24 Jul 2026**: `rdt/` sekarang salah satu app di bawah
root repo yang sama sebagai `auth/` dan `data_user/` (service bersama,
dipakai app lain juga nantinya) — lihat `../CLAUDE.md`. Login/Select
Platform + `current-user.service.ts` sudah pindah ke `../auth/frontend/`,
bukan di `frontend/rdt/` lagi.

Project ini (RDT) punya DUA frontend dengan peran berbeda. Jangan bingung,
jangan dihapus salah satu, dan jaga keduanya tetap sinkron secara desain.

## 1. `backend/src/frontend/rdt/ui-demo.html` — GROUND TRUTH VISUAL
Halaman demo satu-file (vanilla HTML/CSS/JS), di-serve oleh Express di
`http://localhost:4000` (root redirect ke `/rdt/demo`). Tidak butuh build
tooling apapun. **Bukan lagi tempat uji coba interaktif sehari-hari**
(preferensi user berubah 24 Jul — sekarang langsung trial-and-test di
Angular dev-shell), tapi tetap WAJIB disinkronkan sebagai acuan visual
setiap kali Angular berubah.

## 2. `frontend/rdt/` — SOURCE ANGULAR UNTUK INTEGRASI NANTI
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

## Aturan sinkronisasi
- `ui-demo.html` adalah ACUAN VISUAL: alur 3 langkah (unggah → ringkasan +
  matriks rekap ala pivot → detail baris + simpan), palet biru GMF, chip
  status (PENDING/EXCLUDED/INVALID/NEEDS_REVIEW/APPROVED/REJECTED).
- Kalau mengubah tampilan/alur di satu sisi, samakan sisi lainnya.
- Kontrak API RDT-nya sendiri sama untuk keduanya: `POST /api/parse`,
  `POST /api/persist`, `GET/PUT /api/mapping`, `GET/PUT /api/exclusions`
  (lihat `backend/src/index.js`). Login/session sekarang lewat `auth`
  service terpisah (`/auth-api/*`, bukan `/api/auth/*` lagi), directory
  employee lewat `data_user` service (`/data-api/*` dari Angular,
  `/api/directory` dari ui-demo.html — backend RDT tetap proxy itu untuk
  ui-demo.html spesifik).

## Menjalankan

Backend RDT butuh `auth` dan `data_user` service jalan juga (port 4001 dan
4002) supaya fitur login/directory berfungsi:

```bash
cd auth && npm install && npm start        # port 4001
cd data_user && npm install && npm start   # port 4002
cd rdt/backend && npm install && npm start # port 4000, buka http://localhost:4000
npm test           # test parser vs angka pivot terverifikasi (SRS #8)
```

Angular dev-shell (uji coba interaktif, preferensi utama sejak 24 Jul):
```bash
cd rdt/frontend/dev-shell
npm install
ng serve            # buka http://localhost:4200/rdt — proxy ke ketiga service di atas
```
