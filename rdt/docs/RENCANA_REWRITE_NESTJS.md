# Rencana Rewrite RDT → NestJS (Tracking Master)

> Dokumen pegangan untuk rewrite backend RDT dari Express+`pg` polos ke **NestJS**,
> plus restrukturisasi frontend Angular, sesuai review IT GMF.
> Dipakai untuk: (1) tracking progres per-batch, (2) menjaga konteks antar sesi prompting,
> (3) bukti kepatuhan ke tim IT.
>
> **Sumber arahan:** `CATATAN_BE_FE_RDT.pdf` — "RDT Review: Panduan Perbaikan Project OPEX Backend",
> review oleh **Agung Bayu Sapudin (21 Agustus 2026)** + `Clean Code (Robert C. Martin)`.
> **Konteks kunci:** RDT tidak berdiri sendiri — akan **disuntik sebagai bagian dari sistem OPEX/OCX**,
> jadi stack & pola harus selaras dengan OCX existing.

---

## 0. Status Ringkas

| Batch | Nama | Status |
|---|---|---|
| 0 | Fondasi (scaffold NestJS + `core/`) | ✅ Selesai |
| 0.5 | Closeout (migration runner + storage filesystem + verifikasi DB live + Jest) | ✅ Selesai |
| 1 | `repost/upload` (parser Format CBO + parse-preview + test) | ✅ Selesai |
| 2 | `repost/mapping` (mapping + exclusions) | ✅ Selesai |
| 3a | Port modul aturan (rules, DB-independent) | ✅ Selesai |
| 3b | Confirmation core 🔴 (queue + submit + snapshot periode_efektif) | ✅ Selesai |
| 3c | Reassignment inisiator + investigation | ✅ Selesai |
| 3.5a | Persist — modul (duplicate/supersede/originalFile) + test | ✅ Selesai |
| 3.5b | Persist handler (upload→supersede→insert→comment) + download original | ✅ Selesai (real-DB verified) |
| 4a | `repost/export` — baca-saja (waiting queue, lines, transparency, download Format TAB) | ✅ Selesai (real-DB verified) |
| 4b | `repost/export` — POST confirm 🔴 (batch+subdoc pertama+comment/notif, atomik) | ✅ Selesai (real-DB verified) |
| 4c | `repost/export` — subdoc overflow + history (TAB & PIC-scoped) | ✅ Selesai (real-DB verified) — **Batch 4 tuntas** |
| 5a | Notifications (baca + mark-read) | ✅ Selesai (real-DB verified) |
| 5b | Dashboard baca-saja (summary/kpis/rollup/breakdown/need-to-confirm-count) | ✅ Selesai (real-DB verified) |
| 5c | Dashboard detail + comment thread (nutup utang 3b/3c) | ✅ Selesai (real-DB verified) — **Batch 5 (dashboard) tuntas** |
| 5.5a | Period Deadlines (CRUD + overdue/active-pairs) — fitur baru, kelewat dari rencana awal | ✅ Selesai (real-DB verified) |
| 5.5b | Share Cost split (TAB-only) — fitur baru, kelewat dari rencana awal | ✅ Selesai (real-DB verified) — **Batch 5.5 tuntas** |
| 6 | Frontend Angular (restrukturisasi clean-code) | ⬜ Belum |
| 7 | Finishing (lint / dead-code / Swagger / pre-merge / env fail-fast) | ⬜ Belum |

Legenda: ⬜ Belum · 🟨 Jalan · ✅ Selesai & test hijau

---

## 1. Keputusan Terkunci (jangan diubah tanpa alasan kuat)

1. **Backend framework: NestJS** — module-based, DI bawaan, decorator konsisten
   (`@Controller`/`@Injectable`/`@Module`). Wajib, dari IT (selaras OCX).
2. **Struktur folder:** pola `core/` (reusable lintas module) + `modules/` (domain/fitur),
   kebab-case, tiap module self-contained. Mengikuti *prinsip* opex-backend
   (bukan menyalin pohon aslinya — kita tidak punya aksesnya).
3. **Tidak ada `modules/auth`.** Identity (siapa user, dinas apa, role apa) **disediakan OCX**.
   Kita hanya *membaca* lewat `core/security` (Guard + `@CurrentUser()` + `IdentityProvider`
   mode `OCX | dev-mock`). Login & select-platform = urusan cangkang OCX, bukan RDT.
4. **Frontend tetap Angular** — tidak ganti framework. Yang berubah: **restrukturisasi
   clean-code** (smart/dumb component, `core`/`shared`/`features`, penamaan selaras backend).
5. **DB: raw parameterized `pg` dibungkus repository provider (DI)** — bukan ORM.
   Justifikasi di §5. Reversible bila OCX ternyata mewajibkan TypeORM. Postgres **native**
   di `localhost:5432` (sesuai setup lama, `run_rdt_demo.ps1`). **Tanpa Docker.**
6. **Storage: `StorageService` dengan 2 adapter, dipilih via config:**
   - **Dev → `FilesystemStorageAdapter`** (simpan file ke folder biasa). Tidak perlu MinIO/Docker lokal.
   - **Prod/OCX → `MinioStorageAdapter`** (SDK MinIO terkurung di adapter, Clean Code Bab 8).
   Boundary sama untuk keduanya; parser tak pernah tahu storage-nya apa. MinIO OCX toh punya mereka.
7. **Validasi: `class-validator` + `class-transformer`**, DTO di tiap endpoint.
8. **Kualitas: ESLint + Prettier**, cek standar sebelum push/merge, Swagger untuk API docs.

> **Catatan: Docker DIBUANG.** Bukan arahan IT, bukan bagian setup existing (yang native).
> Postgres native + storage filesystem untuk dev → tidak ada infra tambahan. (YAGNI.)

---

## 2. Struktur Target — Backend (NestJS)

Rewrite masuk **folder baru** (`rdt/backend-nest/`), backend Express lama TIDAK ditimpa —
dipakai sebagai referensi kebenaran & sumber logika/SQL yang di-port.

```
rdt/backend-nest/
└── src/
    ├── main.ts, app.module.ts
    ├── config/                    → env, database (tidak ada rahasia di kode)
    ├── core/                      → reusable lintas module, jangan diulang di module
    │   ├── dtos/                  → ApiResponse, Pagination
    │   ├── enums/                 → StatusKonfirmasi, RowStatus, DinasRole
    │   ├── errors/                → domain error class
    │   ├── exception/             → global exception filter
    │   ├── interfaces/            → FormatCboRow (12 kolom Format CBO), DetailRow
    │   ├── types/                 → type definition tambahan
    │   ├── database/              → DatabaseService + repository base (raw pg via DI, withTransaction) + migration runner
    │   ├── storage/               → StorageService + FilesystemStorageAdapter (dev) + MinioStorageAdapter (prod)
    │   ├── security/              → DinasAccessGuard, @CurrentUser(), IdentityProvider (OCX|dev-mock)
    │   ├── swagger/               → setup Swagger
    │   ├── utils/                 → helper murni
    │   └── base.controller.ts     → base controller (di-extend, bukan hiasan)
    └── modules/
        ├── repost/                → DOMAIN BESAR (dipecah sub-fitur ala capex)
        │   ├── upload/            → parser (Format CBO, ExcelJS, route by Recipient) + dtos
        │   ├── mapping/           → dinas mapping + exclusions
        │   ├── confirmation/      → state machine approve/reject/reassign
        │   └── export/            → format TAB, batch/subdoc, periode_efektif, overdue
        ├── comment/               → thread berulir
        ├── notification/
        ├── dashboard/             → agregasi progress per dinas
        ├── audit/                 → audit log
        └── master-data/           → referensi dinas/kurs/cost-center (seed dev; prod bisa dari OCX)
```

---

## 3. Struktur Target — Frontend (Angular, restrukturisasi)

```
src/app/
├── core/         → singleton: interceptor, guards, IdentityService (baca user dari OCX/dev)
├── shared/       → dumb/presentational components, pipes, directives, models (PendingRow, DetailRow)
├── features/
│   └── repost/
│       ├── pages/        → SMART/container: ambil data, pegang state
│       ├── components/   → DUMB/presentational: @Input/@Output, tanpa HTTP
│       ├── services/     → RepostService (HTTP), state
│       └── repost.module.ts
└── app.module.ts / app-routing.module.ts   → lazy-load /repost (siap ditempel ke OCX)
```

Prinsip (dari PDF): smart vs dumb, komponen kecil, kebab-case selaras backend,
no duplikasi logic (→ service/util = padanan "custom hook"), satu tanggung jawab per komponen.
Login/SelectPlatform DIBUANG (identity dari OCX; dev-shell pakai user palsu).

---

## 4. Peta Migrasi — Kode Lama (teruji) → Rumah Baru

| RDT sekarang (Express + `pg`) | Target NestJS | Catatan |
|---|---|---|
| `parser/excelParser.js` — **Format CBO** (ExcelJS, `parseExcelFile(file,{uploaderDinas})`; helper `parseNumber`, `readCellValue`, `buildAllowedCodes`, `buildDetailRow`) | `repost/upload/parser/excel-parser.service.ts` (SATU service) + `core/interfaces/FormatCboRow` | **route by kolom Recipient**; pivot-cache & kontrak 53-kolom SUDAH DIBUANG (rewrite 20 Agu); dipecah jadi method kecil |
| `config/mapping.seed.json` + `config/dinas.codes.json` | copy ke project baru (Batch 1), wiring DB nanti di Batch 2 | parser butuh ini buat resolve Recipient → dinas |
| `POST /api/parse`, `/api/persist` | `upload.controller.ts` + DTO | + DTO & ValidationPipe |
| `GET/PUT /api/mapping`, `/api/exclusions`, `mapping.seed.json` | `repost/mapping/` | aturan **NEEDS_REVIEW jangan nebak** tetap |
| `routes/confirmation.js` (`BEGIN/COMMIT`, `FOR UPDATE`, approve/reject, reassign chain) | `repost/confirmation/confirmation.service.ts` | **transaksi + row-lock WAJIB utuh** (§6-guardrail) |
| export/format TAB 8-kolom, `export_batches`/`export_subdocs`, `periode_efektif`, overdue | `repost/export/` | — |
| `middleware/auth.js` (`requireUser`, `requireDinasAccess`) | `core/security` **Guards** | middleware → Guard; identity dari OCX |
| `sql/schema.sql` + `sql/migrations/001..020` | `core/database` migration runner + `sql/` di-copy | **port SQL apa adanya**, jangan tulis ulang tabel |
| comments / notifications / dashboard / audit_log | module masing-masing | — |

**Acceptance test (jangkar kebenaran):** 44 test lama → port ke Jest, harus tetap hijau.
Angka pivot terverifikasi: **TMM=473.933,51 · TA=1.653,24 · TE=84,36 · Ask TA=40.393,29** (file `06. DT TJ`).

---

## 5. Kenapa raw `pg` + repository, bukan ORM

- PDF hanya mewajibkan **NestJS**, tidak menyebut ORM tertentu.
- Ambil ORM = (a) menebak yang dipakai OCX → salah tebak = mismatch lagi;
  (b) rawan merusak `FOR UPDATE` + transaksi atomik yang jadi jantung kebenaran finansial.
- Solusi: ambil **struktur** ORM (repository class yang di-inject, testable, clean) tapi
  **isi** = SQL teruji kita. Memenuhi arahan "clean, module-based, DI" tanpa mengorbankan korektnya.
- **Reversible:** kalau OCX mewajibkan TypeORM, cukup ganti isi repository — controller/service/DTO tak tersentuh.

---

## 6. Guardrail Clean-Code (aturan tetap sepanjang rewrite)

**Disiplin migrasi (Clean Code – Functions):**
- "Port" ≠ copy-paste. Fungsi besar dipecah jadi method kecil **satu level abstraksi** (stepdown rule).
  44 test = jaring pengaman: refactor bebas selama test hijau.
- Hindari **flag argument** (boolean yang bikin fungsi ngerjain 2 hal) → pecah jadi 2 fungsi.
- Switch/if-else panjang atas status (`PENDING/EXCLUDED/NEEDS_REVIEW/NEEDS_INVESTIGATION`; "Ask TA"=investigation) → kubur di level rendah,
  enum + handler kecil. **Jangan over-engineer** jadi hierarki polimorfik ribet (Clean Code juga anti gold-plating).

**Error handling (Clean Code – Bab 7) = sekalian upgrade kualitas:**
- Backend lama balikin `{ok:false, error:...}` → itu anti-pattern "return error code".
- Ganti ke **throw domain exception + global exception filter** NestJS. `core/exception/` &
  `core/errors/` bukan sekadar ikut struktur, tapi naikin kualitas sesuai buku. (Poin narasi handoff.)

**🔴 GUARDRAIL KERAS — transaksi tidak boleh bocor:**
> Saat pindah ke exception filter global, scope `BEGIN/COMMIT/ROLLBACK` + `FOR UPDATE`
> **tetap di dalam service (unit-of-work `withTransaction`)**. ROLLBACK harus terjadi SEBELUM
> exception naik ke filter. Filter hanya menangani *setelah* rollback. Fokus di Batch 3.
> Status Batch 0: `withTransaction` sudah benar (rollback-before-rethrow + client.release di finally). ✅

**Boundaries (Clean Code – Bab 8):** wrap ExcelJS & storage SDK di balik service kita
(`StorageService` + adapter, parser service) → gampang swap & mock.

**Data dinas — filter `is_active`:** `rdt.dinas` sengaja simpan **5 kode nonaktif**:
4 placeholder (TG/TK/TO/TT → `is_active=false` oleh migration 005) + **TAB** (`is_active=false` oleh
migration 014). Tidak dihapus demi integritas FK. `count(*)` mentah = **28**, **aktif = 23**.
- **Picker/dropdown** (reassign Batch 3, dashboard Batch 5, mapping, `GET /dinas`) WAJIB `WHERE is_active = true` → 23 baris.
- **Routing parser** pakai **SEMUA kode** (tanpa filter is_active) → Recipient "TAB" & kode nonaktif lain tetap RESOLVE, bukan NEEDS_REVIEW. **JANGAN tambah is_active ke query routing.**
- **TAB** kasus khusus: FK target valid + prefix parser-resolvable (buat share-cost target), TAPI bukan tujuan reassign umum → sengaja dikecualikan dari picker.

---

## 7. Deviasi yang Sudah Diterima (transparan ke IT)

1. **Tidak menyalin pohon opex/capex 100%** — kita tak punya akses struktur aslinya; kita patuhi
   *prinsip* di PDF dan tulis konvensi sendiri yang setara.
2. **raw `pg` bukan ORM** — lihat §5.
3. **Versi NestJS + library** tidak bisa disamakan persis dengan OCX (tak ada akses). Kita pakai
   NestJS stable terbaru; **dicatat di handoff** agar IT bisa rekonsiliasi versi saat integrasi.
   (Batch 0: NestJS 11, @nestjs/config 4, @nestjs/swagger 11, pg 8, minio 8, class-validator/transformer.)
4. **MinIO tidak dijalankan lokal** — dev pakai filesystem adapter; MinIO adapter dicadangkan untuk OCX.

---

## 8. Rincian Batch

### Batch 0 — Fondasi ✅
Scaffold NestJS di `rdt/backend-nest/` + `core/` (config, DatabaseService+withTransaction,
exception filter, ValidationPipe global, Swagger, ESLint+Prettier, security dev-mock,
StorageService+MinioAdapter). Build/lint/start/Swagger hijau, `withTransaction` benar.

### Batch 0.5 — Closeout Fondasi ✅
Ditutup 25 Agustus 2026.
1. **Migration runner** (`core/database/migrate.ts`, `npm run migrate`) — `sql/` (schema.sql +
   migrations 001–020) di-copy apa adanya dari `rdt/backend/sql/`. Runner reuse tabel tracking
   `rdt._migrations_applied` yang sama persis dengan yang dipakai `rdt/backend/src/migrate.js`
   lama (DB dev sama, `rdt_dev`) — dijalankan 2x, hasil idempoten (`skip (already applied)` untuk
   ke-20 migration). Seed dinas/mapping/exclusion **tidak diport ulang** dari migrate.js lama —
   sudah ada di `schema.sql` sendiri (`ON CONFLICT DO NOTHING`), port ulang cuma duplikasi.
2. **`FilesystemStorageAdapter`** (`core/storage/`) — simpan/baca file dari folder lokal
   (`STORAGE_LOCAL_PATH`, default `./storage-dev`, di-`.gitignore`). Dipilih via
   `STORAGE_DRIVER=filesystem` (default dev) | `minio` (prod/OCX), wiring lewat DI provider
   (`STORAGE_SERVICE` token) — konsumen tidak tahu adapter mana yang aktif. `MinioStorageAdapter`
   dari Batch 0 tetap ada, tidak dihapus. Diverifikasi: put→exists→get round-trip file sungguhan.
3. **Verifikasi DB live** — `.env` asli arah ke Postgres native `localhost:5432`, DB `rdt_dev`
   (setup existing, sama dengan `rdt/backend/.env`). `GET /health` → `{status:'ok', db:'ok'}`
   terverifikasi lawan DB nyata.
4. **Jest** — `npm test` hijau (2 test sanity untuk `HealthController`, cabang db ok/unreachable).
5. `docker-compose.yml` dari Batch 0 **dihapus** (Docker dibuang per koreksi §1).
Acceptance: semua lolos — lihat detail di atas.

### Batch 1 — repost/upload ✅
Selesai 25 Agustus 2026 (DB-independent, dikerjakan paralel dengan smoke-test DB Batch 0.5).

Port `excelParser.js` (**Format CBO**, ExcelJS, route by kolom Recipient) jadi **SATU** service
`modules/repost/upload/parser/excel-parser.service.ts`, dipecah stepdown jadi method kecil satu
tanggung jawab (header discovery, resolusi dinas_target, resolusi status, helper cell/angka) —
logika & urutan precedence status (termasuk kuirk "nominal invalid overwrite EXCLUDED" dari kode
lama) dipertahankan persis, dikomentari eksplisit biar tidak kepeleset pas Batch 2+ nyentuh lagi.
Dua entry point: `parseFile(path)` (dipakai test, mirror API lama) & `parseBuffer(buffer)`
(dipakai controller — StorageService cuma expose Buffer, bukan path, biar boundary storage tetap
bersih). Seed `mapping.seed.json` + `dinas.codes.json` + `exclusions.config.json` di-copy ke
`modules/repost/upload/config/` (module-local; Batch 2 pindah sumbernya ke DB lewat
`ParseOptions.mapping/exclusions/dinasCodes` yang sudah ada sejak awal, tanpa ubah signature).
Enum `RowStatus` ditambah `NEEDS_INVESTIGATION`. Endpoint `POST /repost/upload/parse`
(multipart, DTO+ValidationPipe) — upload → simpan via `StorageService` → parse → rows + rekap
per (status, dinas_target). **`persist` ke DB DITUNDA** (Batch 3+, butuh transaksi).

Port `test/parser.test.js` → `excel-parser.service.spec.ts` (4 test, fixture asli dari
`rdt/contoh_input/`). **Angka terverifikasi identik dengan versi lama:**
- TB (469 baris, semua PENDING): TC 94732.21, TF 360.21, TJ 46353.37, TL 112867.35, TN 860.64, Corp 3294.95.
- TJ (490 baris): PENDING TE 84.36, TMM 473933.51, TA 1653.24; 3 baris NEEDS_INVESTIGATION = 40393.29 (dinas_target null); 0 NEEDS_REVIEW.
- Recipient tak dikenal → NEEDS_REVIEW + reason memuat nilai mentah; self-repost (Requester==Recipient, case-insensitive) → EXCLUDED.

`npm run build`/`lint`/`test` bersih (6 test total termasuk 2 sanity Batch 0.5). Endpoint juga
diverifikasi manual lewat HTTP nyata (`curl -F file=... -F uploaderDinas=TB`) — 469 baris, rekap
per dinas_target sama persis dengan hasil test, file tersimpan ke `storage-dev/uploads/`.
`rdt/backend/` lama tidak berubah.
**Pivot-cache & 53-kolom SUDAH DIBUANG (rewrite 20 Agu) — jangan diport.**

### Batch 2 — repost/mapping ✅
Selesai 25 Agustus 2026. `modules/repost/mapping/` — `MappingService` (`rdt.dinas_mapping`,
`upsertMany` = merge/upsert via `ON CONFLICT ... DO UPDATE`, **withTransaction**),
`ExclusionService` (`rdt.exclusion_rules`, `replaceAll` = DELETE+re-INSERT, **withTransaction**),
`RoutingConfigService` (assemble `{mapping, exclusions, dinasCodes}` dari DB — dinasCodes
**tanpa filter is_active**, sesuai catatan routing vs picker). `modules/master-data/` baru —
`DinasService.listActive()` (picker, `WHERE is_active=true`) + `DinasService.listAllCodes()`
(routing, unfiltered), `GET /dinas`.

`core/security`: `@Roles()` decorator + `RolesGuard` (baca role dari `IdentityProvider`), TAB-only
di `GET/PUT /repost/mapping` & `GET/PUT /repost/exclusions`. Parser (`ExcelParserService`) TIDAK
diubah — sudah menerima `mapping/exclusions/dinasCodes` sebagai override opsional sejak Batch 1,
jadi `upload.controller.ts` tinggal suntik `RoutingConfigService.assemble()` di jalur HTTP; test
parser Batch 1 (yang tak mengoper config) otomatis tetap pakai seed JSON.

**Terverifikasi lawan DB live (`rdt_dev`), lewat HTTP nyata:**
- `GET /repost/mapping` non-TAB → `403 FORBIDDEN_ROLE`; sebagai TAB → seeded mapping (`TCR→TC`,
  `TJ Plant→TJ`, dst).
- `PUT /repost/mapping {"XYZ":"TE"}` → `XYZ` ketambah, `TCR`/`TJ Plant`/dst **tetap ada** (merge
  terverifikasi, bukan replace).
- `GET /repost/exclusions` → `AUAK`, `PO` (seeded). `PUT {"prefixes":["FOO"]}` → jadi **hanya
  `FOO`** (replace-all terverifikasi, beda semantik dari mapping).
- Rollback: PUT mapping 2 entry, entry ke-2 sengaja langgar FK (`dinas_code` bukan kode nyata) →
  `500`, **kedua entry gagal masuk** (termasuk entry pertama yang valid) — `withTransaction`
  rollback benar.
- Parse via `RoutingConfigService` (DB) → **angka identik Batch 1**: TB 469 baris (TC 94732.21,
  TF 360.21, TJ 46353.37, TL 112867.35, TN 860.64, Corp 3294.95); TJ 490 baris (TE 84.36, TMM
  473933.51, TA 1653.24, 3× NEEDS_INVESTIGATION = 40393.29, 0 NEEDS_REVIEW).
- `GET /dinas` → **23 baris aktif**, bukan 24 seperti perkiraan awal prompt — roster nyata di
  `rdt_dev` punya **5** dinas nonaktif (`TG/TK/TO/TT` + **`TAB`**, di-set `is_active=false` sejak
  migration `014_tab_share_cost_target.sql`), bukan 4. Query-nya sendiri (`WHERE is_active=true`)
  sudah persis sama dengan `index.js` lama — dikonfirmasi bukan bug, cuma angka di prompt yang
  ketinggalan soal baris TAB.
- Test data yang dipakai untuk verifikasi (mapping `XYZ`, exclusions `FOO`, mapping rollback-test)
  sudah dibersihkan lagi ke state seed semula setelah verifikasi.

`npm run build`/`lint`/`test` bersih — **6 test tetap hijau** (2 sanity Batch 0.5 + 4 parser Batch 1,
tidak ada yang pecah). `rdt/backend/` lama tidak berubah.

### Batch 3 — repost/confirmation (DIPECAH: 3a → 3b → 3c)
Terlalu besar & kepaut untuk satu prompt (zona guardrail transaksi 🔴). Dipecah biar scope tiap
prompt sempit → executor tidak "halu".

**3a — Port modul aturan (DB-independent) ✅:** `reassignmentRules`, `periodEffective`, `mentionRules`,
`textValidation`, `stateLabel`, `errorClassification` → fungsi murni + port test-nya (pola parser Batch 1).
Fondasi yang dipakai 3b & 3c. Aman, tak sentuh DB.
Lokasi: `core/errors/error-classification.ts`, `core/utils/text-validation.ts`,
`modules/repost/rules/{state-label,reassignment-rules,period-effective,mention-rules}.ts` — semua
fungsi murni, nol import DB/Express/HTTP (dicek manual, bukan cuma lint). `npm run build`/`lint`/`test`
bersih — **8 suite / 66 test hijau** (2 sanity + 4 parser lama tetap hijau + 6 suite aturan baru,
tak ada yang pecah). `rdt/backend/` lama tidak berubah.

**3b — Confirmation core 🔴 ✅:** GET queue (+ breadcrumb chain) + POST submit (CONFIRM/DECLINE +
`redirect_to`) + snapshot `periode_efektif`. **Guardrail transaksi + `FOR UPDATE` diuji beneran di sini.**
Pembuatan komentar/mention minimal (kepicu confirm) ikut; listing/thread penuh tetap Batch 5.
Lokasi: `modules/repost/confirmation/{confirmation.module,confirmation.controller,confirmation.service}.ts`
(+ `dto/submit-confirmation.dto.ts`). `DinasAccessGuard` (`core/security/dinas-access.guard.ts`)
diisi implementasi nyata (Batch 0 cuma skeleton). Seam `DirectoryProvider` baru (`core/directory/`,
pola sama seperti `IdentityProvider`) — dev baca `employee-directory.seed.json`, prod (`OcxDirectoryProvider`)
masih placeholder (di luar scope). `DomainError`/`GlobalExceptionFilter` ditambah `errorCategory`
opsional supaya respons 500 transaksi bisa bawa `error_category` (dari `classifyError`, 3a).
Rollback-audit ditulis lewat `DatabaseService.query` (pool, koneksi terpisah dari client transaksi
yang barusan ROLLBACK), bukan `logger.js` lama — awalnya private method di `ConfirmationService`,
diekstrak jadi `RollbackAuditService` bersama pas 3c (dipakai reassignment & investigation juga).

Diuji **beneran** lewat HTTP lawan `rdt_dev` (server nyata, `curl` + header `x-dev-*`), bukan cuma
unit test bermock: GET queue (200 + breadcrumb), guard 403 (dinas lain)/200 (TAB ke dinas manapun),
lalu satu batch submit CONFIRM+DECLINE+REJECT_REDIRECT sekaligus — hasil di DB dicek manual (2 ledger
entry pas untuk CONFIRM, `periode_efektif` DECLINE terisi, REJECT_REDIRECT reassign_count+1 &
`periode_efektif` NULL, reply comment + notifikasi mention ter-scope ke pasangan yang benar) — lalu
**atomicity**: batch 1 keputusan valid + 1 id tak ada → 500 dengan `error_category`, baris valid
TETAP tak berubah (tak ke-CONFIRM, nol ledger), dan baris `audit_log` action `ROLLBACK` tetap
tercatat. Semua data uji dikembalikan ke seed setelahnya (diverifikasi ulang via query).
`npm run build`/`lint`/`test` bersih — **11 suite / 82 test hijau** (66 lama + 8 `ConfirmationService`
+ 7 `DinasAccessGuard` + 1 `SeedDirectoryProvider`, tak ada yang pecah — angka `ConfirmationService`
naik ke 8 pas 3c menambah test delegasi ke `PairCommentService`). `rdt/backend/` lama tidak berubah.

**3c — Reassignment inisiator + investigation ✅:** Tanggung Sendiri / Ajukan Ulang / reassign chain +
`investigation.js`. Batch 3 tuntas.

Diekstrak dulu (arahan IT, hindari duplikasi 3b/3c): `modules/repost/shared/pair-comment.service.ts`
(reply-ke-thread-pasangan + notif, dipakai `ConfirmationService` — direfactor — DAN
reassignment/investigation; parameter baru `implicitRecipientDinas` karena confirmation
memberitahu `dinas_inisiasi` sedangkan investigation memberitahu `dinas_target` BARU, dua
konvensi beda yang route lama masing-masing hardcode) dan
`modules/repost/shared/rollback-audit.service.ts` (audit ROLLBACK via koneksi terpisah, port
`logger.js`'s `logRollbackAudit`, dipakai ketiga service transaksi).

Lokasi: `modules/repost/reassignment/{reassignment.module,reassignment.controller,reassignment.service}.ts`
(+ `dto/resolve-declined.dto.ts`) — GET dipagari `DinasAccessGuard`, POST otorisasi PER-BARIS
(dinas_inisiasi baru diketahui setelah `FOR UPDATE`, bukan lewat guard). `resolveOneDeclined`
melempar `DomainError` langsung (400/403/404/409) yang httpStatus-nya dipertahankan sampai
`wrapRollback`. `modules/repost/investigation/{investigation.module,investigation.controller,investigation.service}.ts`
(+ `dto/assign-investigation.dto.ts`) — TAB-only (`RolesGuard`+`@Roles('TAB')`) di semua endpoint;
gate all-or-nothing `assign-all` (setiap item wajib `transaction_id`+`dinas_target`) dijamin
`class-validator` di DTO (400 duluan sebelum handler jalan), bukan dicek manual ulang.

Diuji **beneran** lewat HTTP lawan `rdt_dev`: reassignment — GET (200 + guard 403), resolve BORNE
(`BORNE_BY_INITIATOR`, **nol ledger**), resolve REASSIGN (`dinas_target` baru, `reassign_count`+1,
`periode_efektif` NULL), otorisasi 403 (non-inisiator/non-TAB) & 409 (bukan DECLINED) & 404 (id tak
ada), **cap REASSIGN_CAP=3** (percobaan ke-4 ditolak 400), `batch-resolve` atomik (1 valid + 1
invalid → baris valid TETAP tak berubah, rollback-audit tercatat). Investigation — TAB-only 403 di
GET & kedua POST, `assign` → CONFIRMED + **tepat 2 ledger entry** + `reassigned_from='Ask TA'` +
comment/notif ke dinas BARU (beda arah dari confirmation, teruji), `assign-all` gate 400 (item
tanpa target ditolak sebelum apa pun tersentuh) dan batch sukses → 1 komentar per pasangan
DISTINCT (dua transaksi ke pasangan sama = balas ke thread yang sama, bukan duplikat), atomicity
(1 invalid → semua batal). Semua data uji dikembalikan ke seed (diverifikasi ulang via query).
`npm run build`/`lint`/`test` bersih — **15 suite / 105 test hijau** (82 lama dari 3a+3b + 10
`ReassignmentService` + 6 `InvestigationService` + 4 `PairCommentService` + 3 `RollbackAuditService`,
tak ada yang pecah). `rdt/backend/` lama tidak berubah.

### Batch 3.5 — Persist (parse → DB) [DIPECAH: 3.5a → 3.5b]
Lubang yang ditunda dari Batch 1: tanpa persist, backend baru tak bisa BIKIN transaksi (Batch 3
selama ini diuji lawan data lama di `rdt_dev`). Alur asli: upload → **persist** → confirm → export.

**3.5a — Modul persist (pola 3a): ✅ Selesai.** Port `persist/{duplicateCheck,supersedeCheck,originalFile}.js`
ke `modules/repost/persist/{duplicate-check,supersede-check,original-file}.ts` (fungsi murni, logika
identik). `originalFile.js` dipecah: hanya sisi **sanitasi** (`sanitizeFilename`) yang di-port di sini
(murni, teruji termasuk path-traversal); operasi tulis file (`fs.renameSync` ke uploadDir) SENGAJA
belum di-port — itu seam ke **StorageService** di 3.5b, bukan `fs` langsung. 13 test baru (`.spec.ts`,
1:1 dari 3 file `.test.js` lama, minus 3 test round-trip `saveOriginalFile` yang butuh StorageService
nyata → geser ke 3.5b) + **105 test lama tetap hijau = 118 test / 18 suite total**. Build+lint bersih.
`rdt/backend/` lama tak disentuh.

**3.5b — Handler persist (transaksi): ✅ Selesai.** `modules/repost/persist/{persist.controller,
persist.service,dto/persist-upload.dto}.ts`. `POST repost/persist` (multipart: `rows` JSON-string +
`file` opsional) — period implisit (`currentAutoPeriode`, 3a); lock upload ACTIVE lama dinas+periode
`FOR UPDATE`, supersede via `evaluateSupersede` (3.5a) [**BLOKIR 409** `UPLOAD_SUPERSEDE_BLOCKED` kalau
prior punya ledger/CONFIRMED, ids di message]; simpan file original via **StorageService**
(`uploads/<uploadId>-<sanitizeFilename>`, bukan `fs`); duplicate check via `flagDuplicates` (3.5a,
inert di Format CBO — tak ada `document_no`, port faithful); insert transaksi ter-chunk (`CHUNK_SIZE`
dari param-cap ~65535, semua chunk dalam 1 `withTransaction`); deskripsi → 1 komentar/dinas_target
distinct via `PairCommentService` (3c, reuse — bukan tulis ulang logika comment/notif). Rollback via
`RollbackAuditService` (3c), pola `wrapRollback` sama seperti `ReassignmentService` (statusCode/
errorCode asli dipertahankan, jadi 409 supersede-block tetap 409 setelah rollback-audit).
+ `GET repost/persist/uploads/:uploadId/download` (serve original via `StorageService.getObject`;
authz port faithful dari `routes/uploads.js`: TAB bebas, else inisiator ATAU target sekarang ATAU
target lampau via audit REASSIGN/REJECT_REDIRECT chain tanpa batas hop).
- **Insert HANYA kolom Format CBO hasilkan + turunan** (bukan 53 kolom kontrak lama) — termasuk
  `category` (dipakai `ReassignmentService`/`InvestigationService` yang sudah jalan, walau tak
  disebut eksplisit di daftar kolom prompt asli — disertakan supaya reassignment tak diam-diam pecah).
- **Stale Format CBO (catat):** `duplicateCheck` keys on `document_no` yang Format CBO TIDAK
  hasilkan → praktis **inert**. Port faithful (harmless), tandai limitation — JANGAN ngarang kunci
  dedup baru.
- 19 test baru (`persist.service.spec.ts`, unit-mocked pg client — sama pola `ConfirmationService.spec`)
  + **118 test lama tetap hijau = 137 test / 19 suite total**. Build+lint bersih. `rdt/backend/` lama
  tak disentuh.
- **Real-DB verification (26 Agu, `VERIFY_3.5B_REAL_DB.md`) ✅ — semua langkah lolos, NOL bug ditemukan**
  (bukan cuma unit test lagi). DB terpisah `rdt_persist_test`, `.env` sementara diarahkan ke situ,
  `npm run migrate` + `npm run start`, lalu HTTP nyata: `POST repost/upload/parse` file
  `06. DT TJ - Jun 2026.xlsx` → **490 rows**, recap TE 84.36 / TMM 473933.51 / TA 1653.24 PENDING + 3
  NEEDS_INVESTIGATION 40393.29 (persis acceptance Batch 1) → `POST repost/persist` (multipart `rows`
  + `original_filename` + `file`, header `x-dev-dinas: TJ`) → **201, inserted:490, upload_id:1**, cek
  langsung ke `rdt.transactions`: 490 baris, breakdown per dinas_target/status match persis, kolom
  `account`/`ref_doc`/`sheet_name`/`raw_row_index`/`category`/`raw_payload` **terisi (0 NULL)**,
  `uploads.original_file_path` tersimpan & file-nya ada di `storage-dev/uploads/`. Confirm 1 baris
  (`POST repost/confirmation/TE/submit`, claim YA) → `rdt.ledger_entries` **tepat 2 baris**
  (DEBIT TE / CREDIT TJ, 84.36). Supersede diuji DUA jalur: re-persist TJ (baris sudah CONFIRMED) →
  **409 `UPLOAD_SUPERSEDE_BLOCKED`** seperti seharusnya; persist-dua-kali file TB (belum ada yang
  di-confirm) → upload lama **SUPERSEDED** (469 transaksi ikut SUPERSEDED, audit_log `UPLOAD_SUPERSEDED`
  tercatat), upload baru **ACTIVE**. Field final yang benar dipakai: identity via header
  `x-dev-user-id`/`x-dev-dinas`/`x-dev-role` (role lowercase `staff` untuk non-TAB); `rows` dikirim
  sebagai multipart **text field** berisi JSON-string (bukan file part) — `curl -F "rows=<file"`,
  bukan `-F "rows=@file"` (itu akan terkirim sebagai file part, salah bentuk). Cleanup: server
  di-stop, `.env` `DB_NAME` dikembalikan ke `rdt_dev`, `rdt_persist_test` di-drop. 137 test lama
  tetap hijau setelah (tidak ada kode yang perlu diubah sama sekali).

### Batch 4 — repost/export (Format TAB 8-kolom ONLY) [DIPECAH: 4a → 4b → 4c]
**Hanya Format TAB 8-kolom** — format 53-kolom "contract" lama (`CONTRACT_FIELDS`, `buildContractWorkbookBuffer`)
DIBUANG total (parser sudah Format CBO → kolom itu yatim). Sumber: `rdt/backend/src/routes/exportBatches.js`
(port faithful). Gede & kepaut (WAITING computed, confirm+subdoc atomik, history, download) → dipecah biar
scope tiap prompt sempit, pola sama seperti Batch 3.

**Model kunci (dari header comment kode lama, port apa adanya):**
- **WAITING itu computed, tak pernah disimpan** — tak ada baris `export_batches` sampai TAB betulan confirm
  pasangan itu. `BLOCKING_STATUSES=[PENDING,DECLINED,NEEDS_REVIEW]` vs `ATTACHABLE_STATUSES=[CONFIRMED,
  BORNE_BY_INITIATOR]` — EXCLUDED/NEEDS_INVESTIGATION sengaja di luar dua-duanya.
- **Tak ada state EXPORTED** — download stateless & repeatable, tersedia bahkan SEBELUM batch/confirm ada
  (`GET /export-pair/...`).
- **Overdue sticky**: `periode_efektif` (snapshot one-way dari Batch 3b) yang pernah bergeser dari periode
  declared-mayoritas pasangan itu → overdue permanen, tak pernah balik walau deadline baru diset.
- **POST /confirm** menyatukan create-batch + attach rows + subdoc PERTAMA jadi SATU atomic call (bukan dua
  langkah terpisah seperti versi lebih lama) — `subdoc_number` WAJIB (representasi "sudah post ke SAP").
- **`GET /history` TIDAK TAB-only** — PIC dinas_inisiasi lihat riwayat repost-nya sendiri (auto-scoped
  server-side, tanpa query param dinas), TAB lihat semua. Satu endpoint, dua sudut pandang.
- ⚠️ **Komentar closing_description BUKAN lewat `PairCommentService`** (3c) — kode lama SELALU bikin comment
  top-level BARU (`parent_comment_id: NULL`), tak pernah cek/reply thread lama (beda dari pola
  `PairCommentService` yang reply-kalau-ada-thread). Port logic-nya sendiri di 4b, JANGAN panggil
  `PairCommentService.post()` untuk ini — behaviornya akan diam-diam berubah kalau dipaksa reuse.

**4a — Baca-saja: ✅ Selesai.** `modules/repost/export/{export.controller,export.service,
format-tab-export.service}.ts` + `export.module.ts`. `GET waiting` (agregasi per pasangan +
overdue, `byPair` accumulator di kode — port apa adanya), `GET :batchId/lines`,
`GET transparency/:dinasInisiasi/:dinasTarget` (preview sebelum confirm, `SELECT *`), `GET export/:batchId`
(404 kalau batch tak ada) + `GET export-pair/:dinasInisiasi/:dinasTarget` (download — **Format TAB
8-kolom SAJA**, `MAX_ROWS_PER_FILE=300` → `.zip` (jszip) kalau lebih, urutan chunk = slice `ORDER BY id`,
bukan re-sort). `FormatTabExportService` bungkus ExcelJS + JSZip (Boundaries, konsisten
`ExcelParserService`). Semua TAB-only via `RolesGuard`+`@Roles('TAB')`. Tak ada tulis DB.
- 13 test baru (`export.service.spec.ts` unit-mocked pg + `format-tab-export.service.spec.ts`
  yang benar-benar buka .xlsx/.zip hasil-nya via ExcelJS/JSZip, bukan cuma cek buffer non-kosong)
  + **137 test lama tetap hijau = 150 test / 21 suite total**. Build+lint bersih (seluruh `src/`).
  `rdt/backend/` lama tak disentuh. `jszip` ditambah sebagai dependency langsung (`^3.10.1`,
  sebelumnya cuma transitif lewat `exceljs`).
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung** (bukan DB terpisah — batch ini
  murni baca, jadi aman): `waiting` mengembalikan persis TJ→TE (1 baris CONFIRMED, `overdue:false`,
  `state_label:"Waiting to repost"`), TJ→TA (11 PENDING) dan TJ→TMM (475 PENDING) benar TIDAK
  muncul. Overdue diuji dengan toggle `periode_efektif` sementara (`2026-07`→`2026-08`) lalu
  di-revert — `overdue` berubah `false`→`true`→`false` persis. `:batchId/lines` &
  `export/:batchId` (404 utk batch tak ada) OK. `export-pair/TJ/TE` unduh `.xlsx` nyata,
  dibuka ulang via ExcelJS: 8 header persis (termasuk `"Text "` trailing space), `Qty=1`,
  `UoM='EA'`, `Text="TJ to TE 100528745 006"`. Kasus zip: `rdt_dev` tak punya pasangan >300
  baris CONFIRMED, jadi dipakai **305 baris transaksi sintetis** (TJ→TL, ref_doc bernomor,
  di-`INSERT` langsung + **dihapus lagi setelah verifikasi**) — unduhan jadi `.zip` berisi
  `chunk-1.xlsx` (300 baris, SYNREF-1..300) + `chunk-2.xlsx` (5 baris, SYNREF-301..305), urutan
  terjaga. Non-TAB → 403 di kelima endpoint (dicoba di waiting/transparency/lines/export-pair).
  `rdt_dev` dikembalikan ke state semula (490 transaksi) setelah cleanup — diverifikasi ulang.

**4b — POST confirm 🔴: ✅ Selesai.** `modules/repost/export/{export-confirm.service,dto/confirm-export.dto}.ts`
(endpoint `@Post('confirm')` ditambahkan ke `ExportController` 4a yang sudah ada). Satu transaksi
atomik — re-check gate (nol BLOCKING tersisa untuk pasangan itu, throw 400 `PAIR_NOT_READY`),
`INSERT export_batches`, attach semua baris ATTACHABLE ke batch (0 baris → 400 `NO_ATTACHABLE_ROWS`),
`INSERT export_subdocs` (subdoc pertama, `transaction_ids` custom divalidasi subset dari yang baru
di-attach → 400 `INVALID_SUBDOC_TRANSACTION_IDS` kalau bukan) + attach `subdoc_id` ke baris yang sama,
comment **top-level baru** (`parent_comment_id: NULL`, BUKAN lewat `PairCommentService` — logic
resolusi-penerima union mention-in-pasangan + semua user `dinas==dinas_target`, minus author, di-port
sendiri di service ini) + notifikasi, 2 audit_log (`EXPORT_BATCH_CONFIRM` + `SUBDOC_ADDED`). Reuse
`withTransaction` + `RollbackAuditService` (3c, pola `wrapRollback` sama seperti
`ReassignmentService`/`PersistService` — statusCode/errorCode asli dipertahankan setelah rollback-audit)
+ `resolveMentionedUserIds`/`filterMentionsToPair` (3a) + `DIRECTORY_PROVIDER` (3b) +
`BLOCKING_STATUSES`/`ATTACHABLE_STATUSES` (reuse dari `ExportService` 4a, tidak ditulis ulang).
- 11 test baru (`export-confirm.service.spec.ts`, unit-mocked pg — pola sama `ConfirmationService.spec`)
  + **150 test lama tetap hijau = 161 test / 22 suite total**. Build+lint bersih (seluruh `src/`).
  `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung.** Non-TAB → 403. Pasangan sintetis
  `TC→TH` (1 CONFIRMED + 1 PENDING) → confirm ditolak `400 PAIR_NOT_READY` dengan pesan jumlah blocking
  persis. Pasangan sintetis `TC→TI` (2 CONFIRMED): `transaction_ids` berisi id di luar batch →
  `400 INVALID_SUBDOC_TRANSACTION_IDS` **DAN** terbukti atomik nyata — `export_batches` count tak
  berubah, kedua transaksi tetap `export_batch_id/subdoc_id NULL`, `audit_log` ROLLBACK tercatat;
  confirm ulang dengan `transaction_ids` subset `[id pertama]` saja → 201, `attached_count:2` tapi
  cuma 1 id ter-`subdoc_id`, sisanya `export_batch_id` terisi + `subdoc_id NULL` (siap subdoc
  tambahan 4c), `closing_description` kosong → comment fallback + notifikasi tetap terkirim ke PIC
  dinas_target. Pasangan sintetis `TC→TF` (3 CONFIRMED): `closing_description` ber-@mention dinas
  LUAR pasangan (`@demo-pic-tj`, dinas TJ) → **tidak** ikut `notified_user_ids` (privacy-fix
  terverifikasi lawan DB nyata), `transaction_ids` subset 2-dari-3 → sisanya `subdoc_id NULL`.
  Comment kedua kasus di atas diverifikasi **top-level baru** (`parent_comment_id IS NULL` di DB,
  bukan reply ke thread lama pasangan itu). Semua data sintetis (transaksi, batch, subdoc, comment,
  notification, audit_log terkait) **dihapus setelah verifikasi** — `rdt_dev` diverifikasi kembali
  ke state semula (490 transaksi, 2 export_batches).

**4c — Subdoc overflow + history: ✅ Selesai — Batch 4 TUNTAS.**
`modules/repost/export/{export-subdoc.service,export-history.service,dto/add-subdoc.dto}.ts`
(endpoint `@Post(':batchId/subdocs')` + `@Get('history')` ditambahkan ke `ExportController`).
`POST :batchId/subdocs` (subdoc tambahan buat pasangan >300 baris, transaksi TERSENDIRI dari 4b):
default ke SEMUA baris `subdoc_id IS NULL` batch itu (bukan semua baris batch); `transaction_ids`
custom wajib subset dari unassigned itu (id sudah ter-cover subdoc lain → 400
`INVALID_SUBDOC_TRANSACTION_IDS`); batch 100% tercover → 400 `NO_UNASSIGNED_TRANSACTIONS`; audit
`SUBDOC_ADDED`. TAB-only. `GET history` — **satu-satunya endpoint `repost/export` yang BUKAN
TAB-only** (jadi `@Roles('TAB')` dipindah dari class-level ke tiap handler lain, `history` sengaja
tak dikasih supaya `RolesGuard` lolos tanpa role): TAB lihat semua batch, non-TAB force-scoped
`dinas_inisiasi=user.dinas` server-side (tak ada query param dinas yang diterima sama sekali dari
caller non-TAB). Derivasi `period` (modus/`ORDER BY c DESC, period DESC`) + `period_efektif`
(`MAX`, fallback ke `period`) + `overdue` per batch, subdoc list + `transaction_ids` per subdoc,
`deriveStateLabel` (3a, dengan `subdocNumbers` — beda signature dari `waiting` 4a), filter
`?periode=` diterapkan SETELAH derivasi.
- 14 test baru (`export-subdoc.service.spec.ts` 8 + `export-history.service.spec.ts` 6, unit-mocked
  pg) + **161 test lama tetap hijau = 175 test / 24 suite total**. Build+lint bersih (seluruh
  `src/`). `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung.** Pasangan sintetis `TC→TP` (5
  CONFIRMED) di-confirm (4b) dengan `transaction_ids` subset 3-dari-5 → 2 sisa unassigned. Non-TAB
  → 403 di `:batchId/subdocs`. `transaction_ids` berisi id yang sudah ter-cover subdoc 1 → 400.
  `POST :batchId/subdocs` TANPA `transaction_ids` → subdoc kedua nge-cover **persis 2 sisa
  unassigned itu saja** (bukan diam-diam semua 5 baris) — bukti default-ke-unassigned. Batch lalu
  100% tercover → percobaan subdoc ketiga → 400 "no unassigned transactions to cover". History
  TAB: 3 batch lintas 2 dinas (TC, TJ) termasuk batch baru dengan **2 subdoc urut `created_at`**,
  `transaction_ids` union keduanya = persis 5 baris pasangan itu, `state_label` menyebut kedua
  subdoc number. History non-TAB sebagai TC: hanya 2 batch miliknya sendiri; sebagai TB dengan
  `?dinas_inisiasi=TC` disisipkan di query string (percobaan bypass) → tetap `[]` (parameter itu
  tak pernah dibaca endpoint-nya sama sekali — scoping tak bisa ditembus). Overdue: toggle
  `periode_efektif` satu baris (`2026-07`→`2026-08`, di-revert) → `overdue` `false→true→false`
  persis, filter `?periode=2026-08` saat overdue hanya mengembalikan batch itu, `?periode=2026-07`
  sebelum/sesudah revert konsisten. Semua data sintetis (transaksi, batch, 2 subdoc, comment,
  notification, audit_log terkait) **dihapus setelah verifikasi** — `rdt_dev` diverifikasi kembali
  ke state semula (490 transaksi, 2 export_batches).

### Batch 5 — Pendukung
comment (thread) / notification / dashboard (agregasi per dinas) / audit log.

**5a — Notifications: ✅ Selesai.** `modules/notification/{notification.controller,
notification.service,notification.module}.ts` (top-level module, sejajar `master-data/` —
sesuai pohon target §2, BUKAN di bawah `repost/`). `GET notifications` — 50 notif terbaru milik
user (`recipient_user_id`), JOIN `comments`+`transactions`, + `author_display_name` dari
`DirectoryProvider` (3b, fallback ke `author_user_id` kalau user tak ada di directory);
`unread_count` dihitung dari 50 hasil itu sendiri (bukan query count terpisah, port apa adanya).
`POST notifications/mark-read` — `UPDATE ... WHERE recipient_user_id=$1 AND read_at IS NULL`,
statement tunggal, tak perlu `withTransaction`. Tak ada guard tambahan (pola sama
`UploadController`/`PersistController` — `IdentityMiddleware` global sudah cukup, OCX provider
sendiri yang melempar 401 kalau identity tak ada).
- 3 test baru (`notification.service.spec.ts`, unit-mocked pg+directory) + **175 test lama tetap
  hijau = 178 test / 25 suite total**. Build+lint bersih (seluruh `src/`). `rdt/backend/` lama
  tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung** (murni baca + mark-read, aman
  tanpa DB terpisah). 4 notifikasi nyata sudah ada di `rdt_dev` dari sesi-sesi sebelumnya
  (mention @TA/@TE/@TMM dari `demo-tj`, balasan dari `demo-te`) — `GET notifications` sebagai
  `demo-te` → 1 entri, `unread_count:1`, `author_display_name` fallback ke `demo-tj` (author-nya
  memang tak ada di seed directory saat ini — jalur fallback ke-exercise nyata; jalur
  "ketemu-di-directory" sudah dibuktikan lewat unit test). User tanpa notifikasi sama sekali →
  `{unread_count:0, notifications:[]}`. `POST mark-read` sebagai `demo-te` → `unread_count`
  berikutnya `0`, entri tetap muncul dengan `read_at` terisi. `read_at` **di-revert ke NULL**
  setelah verifikasi — `rdt_dev` diverifikasi kembali ke state semula (4 notifikasi, semua
  unread). "Tanpa identity → 401" tak bisa diuji HTTP nyata di sini (`IDENTITY_MODE=dev-mock`
  selalu resolve identity default) — sudah diverifikasi by-inspection: `OcxIdentityProvider`
  (mode produksi) melempar 401 `IDENTITY_MISSING` kalau header OCX tak ada, sama pola dengan
  batch-batch lain yang endpoint-nya juga tak punya guard eksplisit.

**5b — Dashboard baca-saja: ✅ Selesai.** `modules/dashboard/{dashboard.controller,
dashboard.service,dashboard.constants,shared/dashboard-query-helpers}.ts`. Konstanta KHUSUS
dashboard (`RESOLVED_STATUSES`/`ACTIONABLE_STATUSES`/`OPEN_STATUSES`) — sengaja TIDAK reuse
`BLOCKING`/`ATTACHABLE_STATUSES` dari `repost/export` (4a) walau `RESOLVED_STATUSES` kebetulan
sama isi dengan `ATTACHABLE_STATUSES`, beda semantik. Helper bersama di `shared/` (dipakai lagi
5c): `fetchReassignChainMap`, `fetchReplyCounts`, `fetchInvestigationCounts` (pseudo-card sentinel
`target_dinas:'INVESTIGATION'`) — plain function (bukan `@Injectable`), terima `QueryExecutor`
(struktural cocok `DatabaseService` MAUPUN `PoolClient`, siap dipakai di dalam transaksi 5c nanti).
`buildChainAwareProgress` (chain-to-ORIGINAL-target grouping, visibility-cutoff 100%-resolved-dan-
fully-subdoc'd, period-majority overdue) + `buildNeedToConfirmProgress` (grouping by CURRENT
target, `chain` cuma kalau `length>2`) + `needToConfirmTargetCodes` (`Corp` utk TAB, `TA` TIDAK
pernah ikut) + `fetchNeedToConfirmDinas` (versi murah badge) — private di `DashboardService`,
dikonsumsi 5 endpoint: `summary`, `need-to-confirm-count`, `kpis` (shape beda TOTAL per role, bukan
superset), `per-dinas-rollup` (TAB-only, status pill 4-kasus), `summary/:dinasInisiasi/breakdown`
(TAB-only, filter WAJIB investigation pseudo-card biar tak bocor ke dinas lain).
- **Bug nyata ditemukan & diperbaiki (26 Agu, real-DB testing):** `kpis`'s `waiting_to_repost`
  query di `rdt/backend/src/routes/dashboard.js` outer-WHERE-nya pakai list status BLOCKING-only
  yang SAMA PERSIS dengan param `HAVING`-nya — jadi `HAVING COUNT(*) FILTER(blocking)=0` MUSTAHIL
  tercapai (semua baris yang lolos WHERE sudah pasti blocking), query itu **selalu balikin 0** di
  produksi, kontradiksi komentarnya sendiri dan beda dari `ExportService.getWaiting` (4a) yang
  sudah benar. `rdt/backend/` tak disentuh (tetap begitu di sana); di port Nest ini outer WHERE
  diperluas ke union BLOCKING+RESOLVED (pakai konstanta dashboard sendiri, bukan reuse 4a) supaya
  HAVING-nya benar-benar bisa match. Diverifikasi lawan `rdt_dev`: sebelum fix `waiting_to_repost`
  selalu `0`; sesudah fix → `4`, persis jumlah pasangan resolved-tapi-belum-di-subdoc nyata di DB.
- 14 test baru (`dashboard.service.spec.ts`, "smart mock" yang dispatch respons berdasar isi query
  SQL + params — bukan antrian tetap, karena jumlah/urutan query di sini bergantung data lewat
  guard early-return) + **178 test lama tetap hijau = 192 test / 26 suite total**. Build+lint
  bersih (seluruh `src/`). `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung** (baca-saja, aman). Data sintetis:
  `TC→TQ` (reassign 2x, TR→TS→TQ, resolve di TQ), `TI→TU` (2 baris resolved + fully subdoc'd),
  `TD` (1 pair resolved + 2 `NEEDS_INVESTIGATION` + target `Corp`/`TA`), `TP` (investigation
  terpisah), `TH` (pending), `TN` (resolved-unbatched) — semua di-`INSERT` langsung, **dihapus
  lagi setelah verifikasi**. Hasil: `summary` TAB menampilkan kartu `TC→TR` (target ASLI, bukan
  `TQ`) dengan `chain:[TC,TR,TS,TQ]`, `resolved:1/1`; `TI→TU` **hilang** dari daftar (visibility
  cutoff); `TN→TZ`/`TD→TV` tetap tampil 100% resolved-tapi-unbatched. `need_to_confirm` TAB
  menampilkan `TD→Corp` tapi TIDAK `TD→TA`. `summary` PIC TE: `is_global_view:false`,
  `as_initiator:[]` (TE tak pernah initiate). `kpis` PIC TD: `resolved_count=1=3-2` ✓; `kpis` TAB
  (setelah fix): `waiting_to_repost:4`. `per-dinas-rollup`: 4 pill persis —
  `TJ`/`TD`→investigation (menang walau ada open banyak), `TH`→pending, `TC`/`TN`→waiting-repost,
  `TI`→reposted; non-TAB → 403. `breakdown/TD`: 3 pair asli TD + 1 pseudo-card investigation TD
  (`total:2`) — pseudo-card `TP` (investigation terpisah) **tidak bocor**; non-TAB → 403. Overdue
  toggle `periode_efektif` pada `TC→TQ` → `overdue:false→true`, di-revert. `rdt_dev` diverifikasi
  kembali ke state semula (490 transaksi, 2 export_batches) setelah seluruh data sintetis dihapus.

**5c — Dashboard detail + comment thread: ✅ Selesai — Batch 5 (dashboard) TUNTAS.**
`modules/dashboard/{dashboard-detail.service,dto/post-pair-comment.dto,
shared/dashboard-detail-helpers}.ts` (endpoint ditambahkan ke `DashboardController` yang sudah
ada). Helper baru di `shared/` (nama beda dari helper 5b — beda scope): `canAccessPair` (TAB bebas;
PIC salah SATU sisi pasangan — inisiator ATAU target — boleh akses, bukan cuma inisiator),
`getPairTransactions` (sentinel `INVESTIGATION` case-insensitive → filter status polos tanpa chain;
selain itu → filter ke baris yang dinas_target SEKARANG *atau* salah satu hop
`fetchReassignChainMap`-nya match, reuse helper 5b — attach `chain` PENUH per-transaksi),
`getPairCommentThread` (gabung comment lintas semua transaksi pasangan itu jadi satu thread
kronologis, `author_display_name` via `DirectoryProvider`).
- **3 endpoint**: `GET detail/:initiatorDinas/:targetDinas` (progress dihitung LANGSUNG dari
  `getPairTransactions`-nya sendiri, BUKAN reuse `buildChainAwareProgress` privat 5b — pasangan
  yang dicapai via redirect tak match key agregat 5b yang sudah di-collapse; `chain` tampil kalau
  semua transaksi sepakat **dan** `length>2`), `GET detail/:i/:t/comments` (versi ringan polling),
  `POST detail/:i/:t/comments` (⚠️ pola comment KETIGA di codebase ini — reply kalau
  `parent_comment_id` diberi eksplisit, inherit `transaction_id` PARENT bukan dihitung ulang; tanpa
  itu → top-level baru, anchor ke id transaksi TERBESAR pasangan itu; beda dari `PairCommentService`
  3c (reply-kalau-ada-root) dan dari export confirm 4b (selalu top-level) — **tidak** panggil
  `PairCommentService`). Akses via `canAccessPair` di service, bukan `@Roles()` (`RolesGuard`
  lolos tanpa metadata role, sama pola `history` 4c). Reuse `withTransaction`+`RollbackAuditService`
  (3c, `wrapRollback` pattern sama seperti Persist/ExportConfirm/ExportSubdoc).
- 20 test baru (`dashboard-detail-helpers.spec.ts` 9 + `dashboard-detail.service.spec.ts` 11,
  unit-mocked pg+directory) + **192 test lama tetap hijau = 212 test / 28 suite total**. Build+lint
  bersih (seluruh `src/`). `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung.** Akses: outsider (`TB`) → 403 pada
  `TJ→TC`; PIC inisiator (`TJ`), PIC target (`TC`), dan TAB → semua 200. Pasangan sintetis
  `TJ→TC` (reassigned dari `TR`) — `detail/TJ/TR` (target ORIGINAL) menemukan baris yang
  dinas_target SEKARANG-nya `TC`, `progress` 1/1 100%, `chain:[TJ,TR,TC]` (length 3, tampil);
  `detail/TJ/TC` menampilkan KEDUA baris pasangan itu (2 total, 1 resolved), `chain` **tak** tampil
  (2 baris beda jalur). `detail/TJ/investigation` (huruf kecil) → 3 baris `NEEDS_INVESTIGATION`
  nyata milik TJ, tanpa `chain`. Comment: POST tanpa `parent_comment_id` → anchor ke id transaksi
  TERBESAR pasangan itu (dibuktikan dua kali — termasuk SETELAH baris ber-id lebih besar muncul,
  reply ke comment lama tetap `transaction_id` semula, bukan ikut naik ke id terbaru — bukti
  inherit-dari-parent, bukan hitung-ulang); mention `@demo-pic-tl` (dinas TL, luar pasangan
  TJ↔TC) **tidak** ikut `notified`; `parent_comment_id` tak ada → 400
  `PARENT_COMMENT_NOT_FOUND`; pasangan kosong (`TU→TV`, diverifikasi 0 baris) + POST tanpa parent →
  400 `NO_TRANSACTIONS_FOR_PAIR`. Thread gabungan 4 comment lintas 2 transaksi terbaca sebagai satu
  percakapan kronologis, `author_display_name` benar utk kedua PIC. Semua data sintetis (transaksi,
  audit_log, comment, notification) **dihapus setelah verifikasi** — `rdt_dev` diverifikasi kembali
  ke state semula (490 transaksi, 2 export_batches).

### Batch 5.5 — Fitur baru (kelewat dari rencana awal)
Dua fitur nyata di `rdt/backend/` yang tidak masuk peta migrasi §4 awal — ditambal di sini
sebelum Batch 6 (frontend), biar backend Nest benar-benar setara kode lama sebelum restrukturisasi
Angular dimulai.

**5.5a — Period Deadlines: ✅ Selesai.** `modules/period-deadlines/{period-deadlines.controller,
period-deadlines.service,validate-period-and-deadline,dto/upsert-period-deadline.dto,
dto/upsert-default-deadline.dto}.ts` (module top-level, sejajar `notification`/`dashboard`, BUKAN
di bawah `repost/`). CRUD murni tabel deadline konfirmasi PER PASANGAN × periode + deadline
DEFAULT periode-wide, dikonsumsi `snapshotPeriodeEfektif` (3b) lewat `pickDeadline` (3a) — tak ada
logic snapshot di modul ini sendiri. Reuse `BLOCKING_STATUSES`/`ATTACHABLE_STATUSES` langsung dari
`repost/export/export.service.ts` (4a) — kasus DRY yang tepat di sini (nilainya identik, beda dari
5b yang konstantanya beda nilai jadi sengaja tak direuse). 8 endpoint, TAB-only KECUALI
`GET current-reminder` (semua user login — reminder banner tampil di semua dinas). `POST /` upsert
per-pasangan (validasi dinas aktif via `buildValidCodeMap` 3a, case-insensitive → kode stored-case
kanonik). `POST /default` — upsert default + **sweep** ke pasangan yang SUDAH punya transaksi
non-terminal di periode itu, satu `withTransaction` (no partial-success); `$2::timestamptz` cast
eksplisit dipertahankan (Postgres tak bisa infer tipe di posisi SELECT-list itu tanpa cast).
`DELETE /default/:periode` — HANYA kalau `deadline_at` masih di masa depan (404 kalau tak ada,
400 kalau sudah lewat). `GET overdue`/`GET active-pairs` — dua query terpisah, sengaja tak
digabung (single-purpose masing-masing), keduanya scoped `export_batch_id IS NULL`.
⚠️ Endpoint `POST /override-reevaluate` di kode lama sudah dihapus DI SANA SENDIRI (bukan
kelalaian porting) — sengaja tak di-port, `GET overdue` murni informational, tak ada aksi un-stick.
- 26 test baru (`validate-period-and-deadline.spec.ts` 5 + `period-deadlines.service.spec.ts` 21,
  unit-mocked pg) + **212 test lama tetap hijau = 238 test / 30 suite total**. Build+lint bersih
  (seluruh `src/`). `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung.** `current-reminder` diakses non-TAB
  → 200; endpoint TAB-only lain (`list`/`active-pairs`) → non-TAB 403. Upload+3 transaksi sintetis
  periode `2030-01` (pasangan `TC→TX` PENDING, `TC→TU` CONFIRMED periode_efektif bergeser tapi
  unbatched, `TC→TZ` CONFIRMED tapi SUDAH batched) — `overdue` hanya mengembalikan `TC→TU`
  (`TX` masih PENDING jadi bukan 100% resolved; `TZ` sudah batched jadi di luar scope);
  `active-pairs` hanya mengembalikan `TC→TX` (`open_count:1`). `POST /` set `TC→TX`/`2030-01` →
  row baru (`id:14`); set ulang triple sama dengan `deadline_at` beda → **`id` sama persis**,
  `updated_at` berubah, DB dikonfirmasi cuma 1 baris (bukti upsert, bukan duplikat).
  `dinas_target` tak dikenal (`ZZZ`) → 400. `POST /default` periode `2030-01` → default ter-upsert
  **dan** `swept` berisi PERSIS `TC→TX` (satu-satunya pasangan ber-BLOCKING di periode itu;
  `TC→TU`/`TC→TZ` yang all-resolved **tidak** ikut ter-sweep, dibuktikan lewat isi array `swept`
  yang cuma 1 entri). `DELETE default/2030-01` (deadline masa depan) → 200, row hilang (0 di DB).
  Deadline masa lalu sintetis (`2020-01`) → 400 `DEADLINE_ALREADY_PASSED`, row tetap 1 di DB.
  Periode tanpa row (`2099-12`) → 404. Atomicity sweep-gagal-rollback-default diverifikasi lewat
  unit test (mid-transaction failure mocked) — tak ada pemicu kegagalan DB alami yang aman dicoba
  lewat HTTP nyata tanpa mengorbankan invariant lain, sama seperti batch-batch tulis sebelumnya.
  Semua data sintetis (upload, transaksi, period_deadlines, period_default_deadlines) **dihapus
  setelah verifikasi** — `rdt_dev` diverifikasi kembali ke state semula (490 transaksi, 1
  period_deadline lama (`TJ→TA`, pre-existing, bukan dari sesi ini), 0 period_default_deadlines,
  2 export_batches).

**5.5b — Share Cost split: ✅ Selesai — Batch 5.5 TUNTAS.**
`modules/share-cost/{share-cost.controller,share-cost.service,dto/split-transaction.dto}.ts`
(module top-level, sejajar `period-deadlines`/`notification`/`dashboard`). TAB membelah SATU
baris PENDING jadi beberapa baris `(dinas_target, nominal)` — locked ke PENDING-only (CONFIRMED
sudah punya `ledger_entries`, reversal di luar scope). Skema (`SPLIT_VOID` status,
`split_from_transaction_id`) sudah ada utuh dari migration `012_share_cost_split.sql` (Batch 0.5)
— tak ada migration baru. `GET candidates?q=` — `dinas_target='TAB'` **literal exact match** (bukan
join `is_active`), `q` opsional `ILIKE` account/ref_doc/remark (param sama dipakai 3×).
`POST :transactionId/split` — pra-transaksi: `note` wajib (`validateFreeText` 3a), `splits` array
≥2 baris, tiap baris `dinas_target`+`nominal` (number asli/finite/≠0, port apa adanya termasuk
boleh negatif). Transaksi: lock baris asli `FOR UPDATE` (bukan PENDING → 409), resolve tiap
`dinas_target` ke kode stored-case via `buildValidCodeMap` (3a, tak dikenal → 400), **SUM
dibandingkan dalam SEN (integer)** bukan float (selisih 1 sen pun → 400, atomik — nol perubahan
tersimpan), baris asli → `SPLIT_VOID`, per split `INSERT...SELECT` copy-forward SEMUA kolom
non-override dari baris asli (daftar kolom di-port PERSIS dari kode lama, satu string SQL apa
adanya — bukan direkonstruksi terpisah seperti `persist` 3.5b, karena prompt eksplisit minta
"port PERSIS" dan daftarnya sudah given), `audit_log` `SPLIT_BY_TAB`.
⚠️ **Verifikasi eksplisit dilakukan (per instruksi prompt) apakah logic comment "cari root
top-level pasangan, reply-kalau-ada else top-level baru + resolusi penerima" identik
`PairCommentService` (3c)** — dibandingkan baris-per-baris (query root, `ORDER BY`, fallback
anchor, union mention+implicit-recipient, minus-author): **identik persis** → **`PairCommentService`
DI-REUSE di sini** (kandidat pertama yang genuinely cocok, beda dari export-confirm 4b &
dashboard-detail 5c yang sengaja divergen dan TIDAK reuse). Comment diposting ke thread pasangan
**ASLI** (`dinas_inisiasi` → `dinas_target` ASLI, mis. `'TAB'` — bukan target split manapun),
`implicitRecipientDinas` = target asli juga.
- 16 test baru (`share-cost.service.spec.ts`, unit-mocked pg + `PairCommentService` mock) +
  **238 test lama tetap hijau = 254 test / 31 suite total**. Build+lint bersih (seluruh `src/`).
  `rdt/backend/` lama tak disentuh.
- **Real-DB verification (26 Agu) ✅ lawan `rdt_dev` langsung.** Non-TAB → 403 di kedua endpoint.
  4 baris sintetis `TC→TAB` (S1-S4, upload dipinjam dari upload nyata) — `candidates` hanya
  menampilkan yang PENDING (S1/S2/S4), S3 (CONFIRMED) benar tak muncul; `q=UNIQFINDME` (ref_doc
  unik S4) → cuma S4. Split S1 (100.00 → TH 35 + TU 65, mention `@demo-pic-th` di note) → baris
  asli `SPLIT_VOID`, 2 baris baru PENDING `split_from_transaction_id=9733` benar, kolom
  account/ref_doc/period/curr/remark ter-copy-forward persis (kolom Format-CBO lain kosong di
  kedua sisi karena baris sumber sintetis memang tak diisi situ — mekanisme copy sama utk semua
  kolom, dibuktikan lewat kolom yang terisi). Comment: top-level baru (`parent_comment_id NULL`)
  anchor ke baris asli (9733) — **notified kosong** karena satu-satunya implicit-recipient
  (`demo-tab`, dinas `TAB`) kebetulan = author sendiri (minus-author rule); `@demo-pic-th` (dinas
  TH, target split tapi BUKAN bagian pasangan asli TC↔TAB) tak ikut notified di dua-duanya
  (privacy-fix). Split S4 dengan actor BEDA (`tab-2`, bukan `demo-tab`) → `PairCommentService`
  benar2 **reply** ke root comment pasangan yang sama (bukan top-level baru lagi, karena root
  sudah ada dari split S1) — dan kali ini **`demo-tab` benar ter-notified** (implicit recipient,
  author beda) sementara `@demo-pic-th` tetap tersaring. SUM mismatch 1 sen (S2, 50.01 vs 50.00) →
  400, baris tetap PENDING (atomik, nol perubahan). Baris CONFIRMED (S3) → 409. `dinas_target`
  tak dikenal (`ZZZ`) → 400. `splits` 1 baris → 400. `note` kosong → 400.
  `per-dinas-rollup` TC setelah kedua split: `total:6` (2 SPLIT_VOID **tidak terhitung**, cuma 6
  baris ACTIONABLE — S2 pending + S3 confirmed + 4 baris hasil split) — `SPLIT_VOID` terbukti tak
  pernah bocor ke endpoint lain. Semua data sintetis (transaksi asli+split, comment, notification,
  audit_log rollback) **dihapus setelah verifikasi** — `rdt_dev` diverifikasi kembali ke state
  semula (490 transaksi, 2 export_batches, 1 period_deadline lama).

### Batch 6 — Frontend Angular
Restrukturisasi ke pohon §3, smart/dumb, penamaan selaras, buang Login/SelectPlatform, clean-code pass.

### Batch 7 — Finishing
Lint + hapus dead-code + Swagger final + checklist pre-merge; verifikasi 44 test hijau end-to-end.
**+ Env fail-fast** (schema validation `.env`, ditunda dari Batch 0).
**+ Polish `withTransaction`** (bungkus ROLLBACK try/catch + `release(err)` bila koneksi mati).

---

_Update terakhir: 26 Agustus 2026 — Batch 3.5 (persist) tuntas + real-DB verified (3.5a/3.5b ✅);
**Batch 4 (`repost/export`) TUNTAS** — 4a (baca-saja) + 4b (POST confirm 🔴) + 4c (subdoc overflow +
history) semua real-DB verified ✅. **Batch 5 (Pendukung) TUNTAS** — 5a (notifications) + 5b
(dashboard baca-saja, + 1 bug nyata ditemukan & diperbaiki di `waiting_to_repost`) + 5c (dashboard
detail + comment thread) semua real-DB verified ✅. **Batch 5.5 (fitur baru kelewat) TUNTAS** —
5.5a (Period Deadlines) + 5.5b (Share Cost split, reuse `PairCommentService` terverifikasi cocok)
semua real-DB verified ✅. **Seluruh fitur backend rencana + kelewat sekarang tuntas** — lanjut
Batch 6 (Frontend Angular)._
