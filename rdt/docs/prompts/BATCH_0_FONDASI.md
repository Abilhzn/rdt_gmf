# PROMPT — Batch 0: Fondasi NestJS

> Tempel ke agent eksekutor (Claude Code / OpenCode). Rujukan lengkap:
> `rdt/docs/RENCANA_REWRITE_NESTJS.md`. Batch ini **fondasi saja — TIDAK ada logika bisnis RDT.**

---

## Konteks

Kita me-rewrite backend RDT dari Express+`pg` polos ke **NestJS**, mengikuti review IT GMF
(selaras sistem OCX). Ini Batch 0: menyiapkan kerangka aplikasi + infrastruktur lintas-module
(`core/`) yang akan dipakai semua batch berikutnya. Backend Express lama di `rdt/backend/`
**JANGAN disentuh/ditimpa** — itu referensi kebenaran & sumber logika yang di-port nanti.

## Aturan wajib (jangan dilanggar)

- Framework **NestJS** terbaru stable. Pakai **DI bawaan** (jangan `new` manual untuk service).
  Decorator konsisten (`@Module/@Controller/@Injectable`).
- Struktur folder: `src/core/` (reusable) + `src/modules/` (kosong dulu di batch ini).
  **kebab-case** untuk semua nama file & folder.
- **Tidak ada module auth/login.** Identity berasal dari OCX; di batch ini cukup seam-nya
  (`core/security`, mode `dev-mock` supaya bisa jalan lokal).
- **DB: raw `pg` (node-postgres) dibungkus `DatabaseService` provider (DI)** — BUKAN TypeORM/Prisma.
- **Storage: MinIO** via SDK resmi, dibungkus `StorageService` (SDK jangan bocor ke luar service).
- Tidak ada rahasia di kode — semua lewat `.env` + `config/`. Sediakan `.env.example`.

## Langkah

1. **Scaffold** app NestJS baru di **`rdt/backend-nest/`** (folder baru, jangan di dalam `rdt/backend/`).
   Aktifkan TypeScript `strict` (termasuk `strictNullChecks`).

2. **`config/`** — modul konfigurasi (`@nestjs/config`) yang baca `.env`:
   - koneksi Postgres (host, port, db, user, password)
   - koneksi MinIO (endpoint, port, accessKey, secretKey, bucket)
   - `NODE_ENV`, `PORT`
   Buat `.env.example` berisi semua key (nilai dummy). Pastikan `.env` masuk `.gitignore`.

3. **`core/database/`** — `DatabaseService`:
   - bungkus satu `pg.Pool`, expose `query(text, params)` (parameterized).
   - expose helper **`withTransaction(fn)`**: `BEGIN` → jalankan `fn(client)` → `COMMIT`,
     dan **`ROLLBACK` otomatis bila `fn` throw**, lalu re-throw. Sediakan juga cara pakai
     `SELECT ... FOR UPDATE` di dalam transaksi. (Ini fondasi guardrail transaksi di Batch 3.)
   - `base repository` opsional yang bisa di-extend module lain.

4. **`core/storage/`** — `StorageService` (interface + adapter MinIO):
   - method minimal: `putObject`, `getObject`, `objectExists` (nama silakan clean).
   - SDK MinIO hanya boleh dipanggil di dalam adapter ini (Boundaries — gampang swap ke MinIO OCX).

5. **`core/security/`** — seam identity & otorisasi:
   - `IdentityProvider` dengan 2 mode: **`dev-mock`** (baca user palsu dari header/env untuk lokal)
     & **`ocx`** (placeholder: baca identity dari request context/header yang nanti diisi OCX).
   - `@CurrentUser()` param decorator → ambil `{ userId, dinas, role }`.
   - `DinasAccessGuard` (skeleton) → baca identity, siap dipakai module lain (belum ada rule spesifik).

6. **`core/exception/`** — global exception filter: ubah domain error jadi response JSON konsisten
   (`{ statusCode, message, error }`). **`core/errors/`** — base domain error class.

7. **`core/dtos/`** — `ApiResponse<T>` & `Pagination`. **`core/interfaces/`, `core/types/`, `core/utils/`,
   `core/enums/`** — buat folder + placeholder minimal (enum `RowStatus` = `PENDING|EXCLUDED|INVALID|NEEDS_REVIEW`
   dan `StatusKonfirmasi` boleh diisi sekarang, sisanya kosong).

8. **Global setup di `main.ts`/`app.module.ts`:**
   - `ValidationPipe` global (`whitelist: true`, `transform: true`) — pakai `class-validator` + `class-transformer`.
   - daftarkan global exception filter.
   - **Swagger** (`@nestjs/swagger`) di `/docs` (setup di `core/swagger/`).
   - `base.controller.ts` di `core/` (dibuat untuk di-extend, sertakan satu contoh pemakaian tipis).

9. **Health check** — endpoint `GET /health` balikin `{ status: 'ok' }` (+ optional cek koneksi DB).

10. **`docker-compose.yml`** (dev) — service **Postgres** + **MinIO**, port & kredensial baca dari `.env`.

11. **ESLint + Prettier** — config + script `lint`/`format` di `package.json`. Pastikan hasil scaffold lolos `lint`.

## Acceptance (harus semua lolos)

- [ ] `docker-compose up` menyalakan Postgres + MinIO.
- [ ] `npm run start` → app boot tanpa error, terhubung ke Postgres.
- [ ] `GET /health` → `{ status: 'ok' }`.
- [ ] Swagger UI terbuka di `/docs`.
- [ ] `npm run lint` bersih (0 error).
- [ ] `rdt/backend/` (Express lama) tidak berubah sama sekali.

## Di luar scope Batch 0 (JANGAN dikerjakan)

- Parser Excel / pivot cache, mapping, confirmation, export, format TAB — semua batch berikutnya.
- Rule otorisasi dinas spesifik (baru di Batch 3).
- Integrasi nyata ke OCX/SSO.

## Setelah selesai

Laporkan: struktur folder final yang dibuat, versi NestJS + library utama (untuk catatan handoff ke IT),
dan hasil tiap poin acceptance. Update `rdt/docs/RENCANA_REWRITE_NESTJS.md` §0 → Batch 0 jadi ✅.
