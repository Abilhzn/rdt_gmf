# PROMPT — Batch 2: repost/mapping (Mapping + Exclusions, DB jadi sumber kebenaran)

> Tempel ke agent eksekutor. Rujukan: `rdt/docs/RENCANA_REWRITE_NESTJS.md`.
> Backend lama `rdt/backend/` **JANGAN disentuh** — hanya sumber referensi.
> **Jangan pecahkan test parser Batch 1** — harus tetap hijau.

## Konteks (grounded ke `rdt/backend/src/index.js`)

Batch 1 bikin parser yang resolve Recipient → dinas dari **seed JSON** (fallback). Di app lama,
sumber kebenaran sebenarnya **DB**: fungsi `loadDbRoutingConfig()` baca `rdt.dinas_mapping` +
`rdt.exclusion_rules` + `rdt.dinas`, lalu disuntik ke `parseExcelFile`. TAB ngedit via
`PUT /api/mapping` & `PUT /api/exclusions` (dua-duanya **TAB-only**). Batch 2 = pindahin sumber
mapping/exclusion ke DB + CRUD admin TAB + suntik ke parser.

**Perilaku lama yang WAJIB dipertahankan (dari index.js):**
- `GET/PUT /api/mapping` — **TAB-only**. GET baca `dinas_mapping`. PUT = **upsert/merge** (`INSERT ... ON CONFLICT (prefix) DO UPDATE`), body `{ "<prefix>": "<dinas_code>", ... }`. **Tidak menghapus key yang tak disebut.**
- `GET/PUT /api/exclusions` — **TAB-only**. GET baca `exclusion_rules`. PUT = **replace-all** (DELETE semua lalu re-insert), body `{ "prefixes": [...] }`. (Beda semantik dgn mapping — jaga bedanya.)
- `GET /api/dinas` — **is_active = true only**, `ORDER BY code`. Buat picker/reassign.
- **Routing config parser** (`loadDbRoutingConfig`): `dinasCodes` = **SELECT code FROM rdt.dinas TANPA filter is_active** — nilai Recipient yang match dinas nonaktif-tapi-nyata tetap RESOLVE, bukan NEEDS_REVIEW. (Bedakan dari picker yang active-only. **Jangan tambahin is_active ke query routing.**)

## Tugas

### 1. Module `modules/repost/mapping/`
- `MappingService` (DB, `rdt.dinas_mapping`): `getAll()`, `upsertMany(map)` (merge, **withTransaction**).
- `ExclusionService` (DB, `rdt.exclusion_rules`): `getAll()`, `replaceAll(prefixes[])` (delete+insert, **withTransaction**).
- `DinasService` (DB, `rdt.dinas`): `listActive()` (**WHERE is_active = true**). Boleh taruh di `master-data` kalau lebih pas — konsisten aja.

### 2. `RoutingConfigService` — sumber config untuk parser
- Assemble `{ mapping, exclusions: { prefixes }, dinasCodes }` dari DB (dinasCodes = **semua** kode, lihat catatan di atas).
- Ini pengganti seed-JSON loader Batch 1 **di jalur controller**. 

### 3. Wiring ke parser (jangan rusak test Batch 1)
- Parser HARUS tetap nerima routing config sebagai **param opsional** (mapping/exclusions/dinasCodes),
  **fallback ke seed JSON kalau tak diberi** — sama seperti `parseExcelFile(fp, { uploaderDinas, ...dbConfig })` lama.
  Test parser Batch 1 (tak mengoper config → pakai seed) **tetap hijau**.
- `upload.controller` (jalur HTTP): ambil config via `RoutingConfigService` → oper ke `parseFile/parseBuffer`.

### 4. Otorisasi TAB-only (introduce role guard)
- Tambah `@Roles('TAB')` decorator + `RolesGuard` di `core/security` (baca role dari `IdentityProvider` Batch 0).
- Pasang di endpoint mapping & exclusions. Endpoint `GET dinas` cukup `requireUser`-equivalent (semua user login).

### 5. Endpoint + DTO (ValidationPipe)
- `GET/PUT mapping`, `GET/PUT exclusions`, `GET dinas`. DTO untuk body PUT (mapping: object prefix→code; exclusions: `{prefixes: string[]}`).

## Acceptance
- [ ] `GET mapping` → seeded `{ "TCR":"TC", "TJ Plant":"TJ" }` dari DB.
- [ ] `PUT mapping {"XYZ":"TE"}` → XYZ ketambah, **TCR & TJ Plant tetap ada** (merge, bukan replace).
- [ ] `GET exclusions` → memuat `AUAK` & `PO` (seeded). `PUT exclusions {"prefixes":["FOO"]}` → sekarang **hanya FOO** (replace-all).
- [ ] `GET dinas` → **24 baris aktif** (28 total − 4 nonaktif TG/TK/TO/TT); tidak memuat yang nonaktif.
- [ ] Parse via config DB → **angka identik Batch 1** (TB 469 dst). **Test parser Batch 1 tetap hijau.**
- [ ] Role non-TAB → **403** di endpoint mapping & exclusions.
- [ ] Semua write (PUT) via `withTransaction` (rollback saat error).
- [ ] `npm test`/`build`/`lint` bersih. `rdt/backend/` lama tak berubah.

## Di luar scope
- persist/confirmation/export/dashboard/notification/dll.
- Frontend admin UI (batch frontend).

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya merge-vs-replace + count dinas aktif 24 + parity angka parser), konfirmasi test Batch 1 masih hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 2 ✅.
