# PROMPT — Batch 3.5b: Handler Persist (transaksi) + Download Original

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§6 guardrail, §8 Batch 3.5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 118 test yang sudah hijau.**
> **REUSE, JANGAN reinvent:** `withTransaction`, `RollbackAuditService` (3c), `PairCommentService` (3c),
> `DirectoryProvider` (3b), `StorageService` (0.5), modul 3.5a (`flagDuplicates`, `evaluateSupersede`,
> `sanitizeFilename`), `currentAutoPeriode`/`validateFreeText` (3a). Sumber: `POST /api/persist` di
> `rdt/backend/src/index.js` + `GET /:uploadId/download` di `routes/uploads.js` (port faithful).
>
> 🔴 Zona transaksi. Ini yang bikin sistem fungsional dari DB kosong: upload → **persist** → confirm → export.

## 1. POST persist (`modules/repost/persist/persist.controller.ts` + `.service.ts`)

Terima **multipart**: field `rows` (JSON string hasil parse yang sudah direview) + file original opsional
(field `file`). Guard: `requireUser`-equivalent (identity ada).

**Pra-transaksi (400 kalau gagal, jangan buka transaksi):**
- Parse `rows` defensif (bad JSON → 400). `rows` bukan array → 400.
- `period = currentAutoPeriode()` (3a) — **implisit, JANGAN dari client** (= bulan sebelum bulan upload, server time).
- `original_filename` wajib (400 kalau kosong).
- `validateFreeText(description)` + `validateFreeText(reviewer_note)` tiap baris → **all-or-nothing** (1 gagal = 400, tak ada tulis parsial).
- `dinas_inisiasi`/uploader/`uploaded_by` diturunkan **server-side dari identity**, bukan dari body.

**Transaksi (`withTransaction`) — atomik semuanya:**
1. **Supersede:** `SELECT id FROM uploads WHERE dinas_code=<uploader> AND period=<period> AND status='ACTIVE' FOR UPDATE`.
   Kalau ada prior: ambil transaksinya + `has_ledger_entry` (`EXISTS ledger_entries`), lalu `evaluateSupersede(rows)` (3.5a).
   - `blocked` (prior punya entri ledger/CONFIRMED) → **throw 409** (rollback) dengan pesan + `blocking_transaction_ids` + `prior_upload_ids`. Repost ulang periode ini harus manual dulu.
2. **INSERT upload row** (`dinas_code`, `uploaded_by_user_id`, `original_filename`, `description`, `row_count_total`, `period`) → `uploadId`.
3. Kalau ada prior (tak blocked): `UPDATE uploads SET status='SUPERSEDED', superseded_at, superseded_by_upload_id=<uploadId>`; `UPDATE transactions SET status_konfirmasi='SUPERSEDED'` untuk `supersedeIds`; audit `UPLOAD_SUPERSEDED`.
4. **Simpan file original** (kalau ada): key = `${uploadId}-${sanitizeFilename(original_filename)}` (3.5a) → **`StorageService.putObject`** (bukan `fs`); `UPDATE uploads SET original_file_path=<key>`.
5. **Duplicate check:** kumpulkan `document_no` baris PENDING (kalau ada), query existing, `flagDuplicates(rows, existing)` (3.5a). *(Inert di Format CBO karena tak ada document_no — port faithful, jangan diubah.)*
6. **Insert transaksi ter-chunk (atomik, dalam transaksi yang sama):**
   - **Insert HANYA kolom yang parser Format CBO hasilkan** + turunan — JANGAN hardcode daftar 65-kolom lama (mayoritas akan null). Kolom yang dipakai: `upload_id`, `dinas_inisiasi`, `dinas_target`, `nominal`, `status_konfirmasi`, `is_reversal` (turunan: `nominal<0`), `invalid_reason`(←`reason_if_invalid`), field Format CBO (`account`, `profit_ctr`, `ref_doc`, `period`, `text_desc`, `material`, `in_pclc`, `curr`), metadata (`sheet_name`←`sheet`, `raw_row_index`←`row`, `remark`, `raw_payload`←`JSON.stringify`, `sub_group`, `reviewer_note`). Kolom kontrak lain biarkan default NULL.
   - **Chunk** biar di bawah cap 65535 bind-param (CHUNK_SIZE ≈ `floor(60000/jumlahKolom)`); semua chunk **dalam satu transaksi** (tetap atomik). `RETURNING id, dinas_inisiasi, dinas_target`.
7. **Deskripsi → komentar/notif:** kalau `description` ada, satu top-level comment **per `dinas_target` distinct** (skip self-repost), pakai **`PairCommentService`** (3c) + directory. Anchor ke salah satu transaksi upload ini untuk pasangan itu.
8. `COMMIT`. Response: `{ inserted, upload_id, duplicates_flagged, superseded_upload_ids, superseded_transaction_count }` (konvensi ApiResponse baru).

**Gagal:** `withTransaction` rollback → `RollbackAuditService` (koneksi terpisah, 3c) → throw domain exception + `error_category`.

## 2. GET uploads/:uploadId/download (serve file original)

- `SELECT dinas_code, original_filename, original_file_path FROM uploads WHERE id=$1`. Tak ada / tak punya file → 404.
- **Otorisasi** (port faithful dari uploads.js): TAB → boleh; else boleh kalau user **inisiator** (`dinas_code==user.dinas`),
  ATAU **target sekarang** (ada transaksi upload ini dgn `dinas_target==user.dinas`), ATAU **target lampau**
  (muncul sebagai `from_dinas` di audit `REASSIGN`/`REJECT_REDIRECT` transaksi upload ini — tanpa batas hop). Selain itu → 403.
- Ambil file via **`StorageService.getObject`** (bukan `fs`), stream sebagai attachment (`original_filename`). Tak ada di storage → 404.

## Acceptance (HTTP nyata lawan rdt_dev; bersihkan data uji setelahnya)
- [ ] Persist upload BARU (dinas+periode belum ada) → upload row ACTIVE + N transaksi PENDING/EXCLUDED/NEEDS_REVIEW/NEEDS_INVESTIGATION sesuai hasil parse; response `inserted` benar.
- [ ] File original tersimpan via StorageService; `GET download` mengembalikannya byte-for-byte; authz 403 utk dinas non-terkait, 200 utk inisiator/target/TAB.
- [ ] **Supersede:** re-upload (dinas+periode sama) yang prior-nya BELUM ada ledger → prior jadi SUPERSEDED, transaksinya SUPERSEDED, upload baru ACTIVE. Prior yang SUDAH punya ledger/CONFIRMED → **409**, tak ada perubahan.
- [ ] **Atomicity 🔴:** paksa gagal di tengah (mis. 1 reviewer_note invalid → 400 pra-transaksi; atau error DB di chunk → rollback) → **nol** upload/transaksi tersisa; rollback-audit tercatat (koneksi terpisah).
- [ ] Deskripsi → 1 komentar per dinas_target distinct + notif (via PairCommentService), tak bocor antar-pasangan.
- [ ] Chunk: file besar (>~1000 baris) tetap masuk semua dalam 1 transaksi.
- [ ] End-to-end dari DB kosong-ish: persist → baris muncul di confirmation queue (Batch 3) → bisa di-CONFIRM. **118 test lama hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope
- Export/format TAB → Batch 4. Listing komentar/notif penuh, dashboard → Batch 5.
- Re-parse server-side (persist menerima rows hasil review dari client — port faithful).

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya supersede block-vs-replace, atomicity, end-to-end persist→confirm), konfirmasi 118 test lama hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3.5b ✅ (persist tuntas).
