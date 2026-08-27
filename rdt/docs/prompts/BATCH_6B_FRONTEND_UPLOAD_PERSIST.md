# PROMPT — Batch 6b: Frontend — Upload/Persist (repost-budgeting)

> Tempel ke agent eksekutor. Jalankan SETELAH 6a selesai (butuh fondasi core/interceptor identity).
> Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 6). Backend `rdt/backend/` & `rdt/backend-nest/`
> **JANGAN diubah**. `auth/frontend/` **JANGAN diubah**.

## Konteks — komponen ini STALE, bukan sekadar direstruktur

Sumber: `rdt/frontend/rdt/pages/repost-budgeting/repost-budgeting.component.ts` (+ html/scss) +
`rdt/frontend/rdt/services/transaction.service.ts` + `transaction.model.ts`. Komponen ini ditulis
untuk backend **lama** (format 53-kolom "contract", endpoint `/api/parse`+`/api/persist`,
`{ok,rows,aggregation,error}`). Backend sekarang **Format CBO** (12 kolom) dengan endpoint & shape
berbeda. Ini genuinely menyambungkan ulang logika, bukan cuma memindah file.

**Kontrak backend-nest yang BENAR (sudah pasti, dari Batch 1 & 3.5b):**
- `POST repost/upload/parse` — multipart: `file` (xlsx) + `uploaderDinas` (kode dinas pengunggah,
  string). Response `{data: {...}}` — **cek struktur persis di `upload.controller.ts`/DTO
  backend-nest sebelum implementasi**, jangan asumsi nama field dari komponen lama.
- `POST repost/persist` — multipart: `rows` (JSON-string dari array rows hasil parse/review),
  `original_filename`, `description` (opsional), `file` (opsional, xlsx asli). Response
  `{data: {inserted, upload_id, duplicates_flagged, superseded_upload_ids,
  superseded_transaction_count}}`.
- **Status transaksi**: `PENDING | EXCLUDED | NEEDS_REVIEW | NEEDS_INVESTIGATION` (BUKAN `INVALID`
  — itu status lama yang sudah tidak ada). Update `TransactionStatus` type & semua tempat yang
  mengasumsikan `INVALID` (termasuk `statusCounts` di komponen, `.chip--invalid` di scss/html).
- **Field per-baris** (Format CBO + turunan, dari `persist.service.ts` `INSERT_COLUMNS` — field
  yang ADA di setiap baris hasil parse): `account`, `profit_ctr`, `ref_doc`, `period`, `text_desc`,
  `material`, `in_pclc` (nominal), `curr`, `dinas_inisiasi`, `dinas_target`, `category`, `remark`,
  `sheet_name`, `raw_row_index`, `status_konfirmasi`, `invalid_reason`. **TIDAK ADA lagi**
  `CONTRACT_FIELDS`/`GET /api/contract-fields` — 12 kolom Format CBO itu **fixed**, bukan dinamis
  dari server. Preview column list boleh HARDCODE (tak perlu di-fetch), tapi tetap kurasi ke subset
  yang relevan (komentar lama bilang 7 kolom + dinas + category + remark — pertahankan semangat
  kurasi itu, sesuaikan key ke Format CBO).
- `PairCommentService`/deskripsi persist → notifikasi ke `dinas_target` masing-masing baris — tidak
  ada UI khusus dibutuhkan untuk ini di sisi persist, itu server-side.

## Tugas

1. **Buat `features/repost/`** (per pohon §3 dari 6a): `pages/repost-budgeting-page.component.ts`
   (SMART — state, HTTP call), `components/` (DUMB — mis. `file-dropzone`, `preview-table`,
   `aggregation-matrix` — pecah dari satu komponen monolitik, `@Input`/`@Output` saja, tanpa HTTP),
   `services/repost.service.ts` (ganti nama dari `transaction.service.ts`, request/response sesuai
   kontrak baru di atas, pakai response-unwrap util dari 6a).
2. **Update model** (`shared/models/` dari 6a): `Transaction`/`TransactionStatus` sesuai status baru,
   hapus dependency ke `ContractField`/`contractFields` dinamis.
3. **Gunakan interceptor identity-bridge (6a)** — komponen ini tidak perlu tahu soal header, cukup
   pakai `HttpClient` biasa via service baru, interceptor yang urus.
4. Pertahankan UX yang ada (drag-drop, filter multi-kolom, pagination, debounced search, reset-on-
   user-switch item 3, animated success modal) — itu bagus, bukan bagian yang stale. Reuse
   `shared/pagination.component`, `shared/multi-value-filter.component`, `shared/modal.service`.
5. **Baca kode `upload.controller.ts`/`persist.controller.ts` + DTO-nya langsung di
   `backend-nest`** sebelum implementasi final — konfirmasi nama field response persis (jangan
   tebak dari deskripsi di atas, itu ringkasan, bukan spec lengkap).

## Acceptance
- [ ] Upload file `.xlsx` asli → parse → preview tampil dengan kolom Format CBO (12 kolom kurasi),
  status termasuk kemungkinan `NEEDS_REVIEW`/`NEEDS_INVESTIGATION` (bukan `INVALID`).
- [ ] Commit/persist → sukses → modal sukses → form reset (item 2/3 lama dipertahankan).
- [ ] Filter/search/pagination masih berfungsi di atas data baru.
- [ ] Ganti user (`CurrentUserService`) → state direset (item 3 lama).
- [ ] Tidak ada referensi tersisa ke `CONTRACT_FIELDS`/`/api/contract-fields`/`INVALID` status.
- [ ] `ng build`/lint bersih. Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: struktur `features/repost/` final, field response yang dikonfirmasi dari source
backend-nest (bukan tebakan), screenshot/deskripsi UI kalau bisa. Update tracker §0 → Batch 6b ✅.
