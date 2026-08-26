# PROMPT — Batch 0.5: Closeout Fondasi

> Tempel ke agent eksekutor. Rujukan: `rdt/docs/RENCANA_REWRITE_NESTJS.md`.
> Batch ini **menutup gap Batch 0** sebelum masuk logika bisnis. Masih **nol logika bisnis RDT.**
>
> **Koreksi atas Batch 0:** Docker DIBUANG (bukan arahan IT, setup existing native). MinIO
> TIDAK dijalankan lokal — dev pakai adapter filesystem; MinioAdapter dari Batch 0 tetap ada,
> dicadangkan untuk prod/OCX. Kalau Batch 0 sempat bikin `docker-compose.yml`, hapus.

## Konteks

Batch 0 sudah scaffold NestJS di `rdt/backend-nest/` (`core/` + DatabaseService + withTransaction +
StorageService/MinioAdapter + security dev-mock + exception filter + Swagger + lint). Yang belum:
(1) belum ada yang bikin skema tabel, (2) storage dev belum ada opsi filesystem, (3) koneksi DB
belum kebukti live, (4) Jest belum dikonfirmasi. Batch 0.5 menutup keempatnya.

Backend Express lama `rdt/backend/` **JANGAN disentuh** — hanya dibaca sebagai sumber SQL & referensi.

## Tugas

### 1. Migration runner (di `core/database/`)
- **Copy** folder `rdt/backend/sql/` (berisi `schema.sql` + `migrations/001_*.sql` … `020_*.sql`)
  ke `rdt/backend-nest/sql/`. **Jangan tulis ulang definisi tabel** — SQL ini sudah teruji, cukup dipindah.
- Buat runner (mis. `core/database/migrate.ts` atau script node) yang:
  - apply `schema.sql` dulu (bila belum), lalu `migrations/*.sql` **berurutan menurut nomor**.
  - **idempoten**: catat migration yang sudah dijalankan di satu tabel (mis. `_migrations`),
    skip yang sudah pernah jalan. Aman dijalankan berkali-kali.
  - pakai `DatabaseService`/koneksi `pg` yang sama (raw SQL, bukan ORM).
- Sediakan script `npm run migrate`.
- (Lihat dulu isi `rdt/backend/src` — kemungkinan ada `migrate.js` lama; ** port logikanya**, jangan bikin paradigma baru.)

### 2. FilesystemStorageAdapter (di `core/storage/`)
- Implementasi `StorageService` yang simpan/baca objek dari folder lokal (mis. `E:\_tadashi\project\storage-dev`).
- Pilih adapter via config: `STORAGE_DRIVER=filesystem` (default dev) | `minio` (prod/OCX).
  Wiring lewat DI provider — controller/service konsumen **tidak tahu** adapter mana yang dipakai.
- `MinioStorageAdapter` dari Batch 0 **tetap ada**, tidak dihapus. Tambahkan `STORAGE_DRIVER` ke `.env.example`.

### 3. Verifikasi DB live
- Arahkan ke **Postgres native `localhost:5432`** (bukan Docker). Buat `.env` asli dari `.env.example`
  dengan kredensial lokal (jangan commit `.env`).
- Jalankan `npm run migrate` → pastikan semua tabel kebuat tanpa error.
- Jalankan app → `GET /health` harus balikin `db:'ok'` (bukan `unreachable`).

### 4. Jest
- Konfirmasi `npm test` jalan (NestJS default sudah bawa Jest). Perbaiki config bila perlu.
- **Belum port test bisnis** — itu Batch 1. Cukup pastikan harness hidup (boleh 1 test sanity).

## Acceptance (harus semua lolos)
- [ ] `npm run migrate` bikin semua tabel (schema + 001–020) tanpa error; dijalankan 2x tetap aman (idempoten).
- [ ] `GET /health` → `{ status:'ok', db:'ok' }` lawan Postgres native lokal.
- [ ] Upload file dummy via `StorageService` (driver=filesystem) → file tersimpan di folder, bisa dibaca lagi.
- [ ] `npm test` jalan (minimal 1 test hijau).
- [ ] `npm run lint` bersih.
- [ ] Tidak ada `docker-compose.yml` tersisa; `rdt/backend/` lama tidak berubah.

## Di luar scope (JANGAN dikerjakan)
- Parser Excel / pivot cache / mapping / confirmation / export — batch berikutnya.
- Menjalankan MinIO. Adapter-nya ada, tapi dev pakai filesystem.
- Env fail-fast schema validation — ditunda ke Batch 7.

## Setelah selesai
Laporkan: daftar tabel yang terbentuk dari migration, hasil `/health`, bukti file tersimpan via filesystem adapter,
hasil `npm test`. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 0 & 0.5 jadi ✅.
