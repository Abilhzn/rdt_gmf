# PROMPT — Batch 6a: Frontend Fondasi (struktur, HTTP client, dev-shell, shell/guards)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§3, §8 Batch 6).
> Backend lama `rdt/backend/` **JANGAN disentuh**. Backend baru `rdt/backend-nest/` **JANGAN
> diubah** (batch ini murni frontend). **Modul shared `auth/frontend/` (Login/SelectPlatform/
> CurrentUserService) JANGAN DIUBAH** — itu infra dipakai lintas-app (rdt + calon ibt), bukan milik
> RDT untuk direstrukturisasi. Ini fondasi buat 6b-6f — **JANGAN sentuh isi 8 modul fitur**
> (`admin/`,`confirm/`,`dashboard-detail/`,`home/`,`need-approval/`,`repost-history/`,
> `setting-periode/`,`share-cost/`) di batch ini, itu scope batch-batch berikutnya.

## Konteks penting (temuan grounding — baca dulu sebelum kerja)

- **Backend konsolidasi jadi SATU app** (`backend-nest`, port default `3000`), bukan 3 service
  terpisah (dulu 4000/4001/4002). `dev-shell/proxy.conf.json` masih arah ke 3 port lama — perlu diupdate.
- **`ApiResponse` envelope backend-nest**: SEMUA response sukses berbentuk `{ data: T, message:
  string }` (`core/dtos/api-response.dto.ts`). Error lewat HTTP status + body `{statusCode,
  message, error, errorCategory?}` (exception filter global) — bukan `{ok:false,error}` gaya lama.
- **Identity: DUA mekanisme berbeda, jangan disamakan:**
  - `CurrentUserService` (shared, `auth/frontend/services/current-user.service.ts`) — login
    username/password ke service `auth` LAMA (port 4001), pakai header `X-Session-Token`. Ini
    **provisional TODO** milik tim auth sendiri (komentar kode: "at that point this whole service
    is deleted, not just its data source swapped") — **JANGAN diubah di sini**.
  - `backend-nest` dev-mock (`IDENTITY_MODE=dev-mock`) baca identity dari header **`x-dev-user-id`
    / `x-dev-dinas` / `x-dev-role`** — beda total, bukan token/session.
  - **Jembatan yang perlu dibuat** (kode BARU, di `core/` milik RDT, BUKAN mengubah
    `CurrentUserService`): satu `HttpInterceptor` yang baca `CurrentUserService.current` (field
    `id`/`dinas`/`role` — lihat `current-user.model.ts`) dan menambahkan header
    `x-dev-user-id`/`x-dev-dinas`/`x-dev-role` ke tiap request **yang menuju `backend-nest`**
    (bukan yang menuju `/auth-api`/`/data-api`). Kalau `current` null, biarkan lolos tanpa header
    (backend akan 401, itu perilaku benar).
  - **Produksi/OCX**: identity kemungkinan besar disuntik platform OCX sendiri (cookie/header dari
    host), RDT tak perlu bikin mekanismenya — cukup pastikan interceptor ini **tidak** menimpa
    header yang mungkin sudah diset platform (kalau ragu, cek dulu apakah header sudah ada sebelum
    set — port defensif, jangan asumsi).
- **`shared/` sekarang sudah lumayan rapi** (`chain-hop-detail`, `mention-input`, `mention-text`,
  `modal`, `multi-value-filter`, `pagination` components + `shared.module.ts` +
  `timeout.interceptor.ts`) — kemungkinan besar TETAP di lokasinya, cukup diverifikasi cocok
  dengan pohon target §3, tak perlu dibongkar ulang paksa.

## Tugas

### 1. Struktur folder target (§3)
Buat `core/` (baru) di `rdt/frontend/rdt/` — isi: interceptor identity-bridge (di atas),
`timeout.interceptor.ts` (pindah dari `shared/` kalau memang lebih pas sebagai singleton `core`),
guards (`rdt.guard.ts`, `role.guard.ts` — pindah dari `guards/` lama), base HTTP config/constants.
`shared/` tetap isi presentational component + model bersama (`transaction.model.ts`,
`comment.model.ts`, `notification.model.ts` dari `services/` lama — model **bukan** service, pindah
ke sini). `features/` **disiapkan strukturnya saja** (folder kosong per target 6b-6f:
`repost/`, `confirmation/`, `dashboard/`, `export/`, `admin/`) — isinya diisi batch berikutnya.

### 2. HTTP client — base URL terpusat
Satu tempat (mis. `core/api-config.ts` atau environment file) yang define base path backend-nest
(`/api` tetap, ATAU prefix baru — **cek dulu apakah `backend-nest` punya global prefix** di
`main.ts`, port apa adanya, jangan asumsi `/api` otomatis sama). Response unwrap `{data,message}`
→ satu util/interceptor supaya **16 service TIDAK perlu masing-masing `.pipe(map(res=>res.data))`
manual berulang** (hindari duplikasi — arahan IT). Error handling: 4xx/5xx dari exception filter
baru (`{statusCode,message,error,errorCategory}`) — siapkan util ekstrak pesan buat ditampilkan
(dipakai nanti oleh 6b-6f, cukup util-nya saja di sini, belum wiring ke tiap service).

### 3. `dev-shell/proxy.conf.json`
`/api` → `http://localhost:3000` (sesuaikan port asli `backend-nest`, cek `.env`/`main.ts`).
`/auth-api`/`/data-api` **TETAP** arah ke port 4001/4002 (punya tim auth, di luar scope kita,
JANGAN diubah/dihapus — `CurrentUserService` masih butuh itu buat login flow-nya sendiri).

### 4. `guards/rdt.guard.ts` & `role.guard.ts`
Pindah ke `core/guards/`. **Logic tidak berubah** (masih pakai `CurrentUserService.current`,
client-side UX gate saja) — HANYA update komentar yang menunjuk `middleware/auth.js` lama, ganti
referensi ke `DinasAccessGuard`/`RolesGuard` (backend-nest) sebagai security boundary sebenarnya.

### 5. `shell/` — cek wiring
Pastikan `ShellComponent` (dan `rdt.module.ts`/`rdt-routing.module.ts`) tetap konsisten setelah
guards/interceptor pindah lokasi (update import path). **Jangan restrukturisasi isi shell** kalau
tak ada yang benar-benar rusak — itu bukan salah satu dari 8 modul fitur, tapi juga bukan fokus
batch ini di luar wiring.

## Acceptance
- [ ] `dev-shell` (`npm start`) tetap bisa jalan (`ng serve` sukses, tak ada import path patah).
- [ ] Interceptor identity-bridge terpasang, terverifikasi: set `CurrentUserService` user palsu
  (`id/dinas/role`) → request ke backend-nest (`/api/...`) membawa header `x-dev-*` sesuai; request
  ke `/auth-api`/`/data-api` **TIDAK** kena header itu.
- [ ] Response unwrap util berfungsi (test manual/unit: `{data:{foo:1},message:'OK'}` → `{foo:1}`).
- [ ] Guards pindah lokasi, komentar terupdate, `RdtGuard`/`RoleGuard` masih berfungsi (redirect ke
  login/forbidden sesuai kondisi lama).
- [ ] `auth/frontend/` **tidak ada perubahan sama sekali** (`git diff` kosong di folder itu).
- [ ] `rdt/backend/` dan `rdt/backend-nest/` **tidak ada perubahan** — batch ini murni frontend.
- [ ] 8 folder modul fitur (`admin/`,`confirm/`,dst) **belum disentuh isinya** — cuma referensi
  path yang mungkin perlu update kalau ada import ke guards/shared yang pindah lokasi.

## Setelah selesai
Laporkan: struktur `core/`/`shared/`/`features/` final, bukti header identity-bridge jalan, port
backend-nest yang dipakai di proxy config (dan dari mana angkanya dikonfirmasi), daftar file yang
pindah lokasi + importer yang ikut diupdate. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 6a ✅.
