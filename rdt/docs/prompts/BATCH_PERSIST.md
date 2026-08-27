# PROMPT — Batch Persist (upload → DB): bikin backend fungsional dari nol

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§6 guardrail).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 105 test yang sudah hijau.**
> Ditunda dari Batch 1 — ini "upload part 2". Tanpa ini backend baru **tak bisa membuat transaksi** (alur putus dari nol).
>
> **REUSE (jangan reinvent):** `withTransaction` + rollback-audit (`rollback-audit.service.ts` 3c),
> `StorageService` (0.5), `DirectoryProvider` (3b), pair-comment/notif helper (3c),
> dan modul 3a: `currentAutoPeriode` (`period-effective`), `validateFreeText`, `mentionRules`.
> Sumber: `POST /api/persist` di `rdt/backend/src/index.js` + `src/persist/*` (port faithful).

## PART 0 — Port 3 modul persist (murni) + test

- **`supersedeCheck.js`** → `evaluateSupersede(oldTxns)` + `ALREADY_INERT_STATUSES`. Murni.
  Aturan: ada baris ber-`has_ledger_entry` → **blocked**; else non-inert → `supersedeIds`. (ledger = fakta uang sudah pindah, bukan whitelist status.)
- **`duplicateCheck.js`** → `naturalKeyOf`, `buildExistingKeyIndex`, `flagDuplicates(rows, existingRows)`. Murni.
  Cross-upload saja; PENDING yang cocok natural-key → `NEEDS_REVIEW` + reason. Within-file match BUKAN duplikat.
- **`originalFile.js`** → `sanitizeFilename(name)` **murni** (anti path-traversal, split manual `\`/`/`, bukan `path.basename`).
  `saveOriginalFile` → **lewat `StorageService`** (bukan `fs` langsung).
- Port test: `supersedeCheck.test.js`, `duplicateCheck.test.js`, `originalFile.test.js` → Jest, logika identik.

## PART 1 — Orkestrasi `POST persist` (di modul upload, transaksi 🔴)

Input (DTO + ValidationPipe): `rows` (hasil parse Batch 1, sudah di-review), optional file asli, `original_filename`
(**wajib**, 400 kalau kosong), `description` (opsional), tiap row `reviewer_note`.
**Derive server-side dari identity (BUKAN body):** `dinas_inisiasi` = uploader, `uploaded_by` = user id.
`period` = **`currentAutoPeriode()`** (implisit = bulan sebelum bulan upload; 3a).

Pra-transaksi: `validateFreeText(description)` + tiap `reviewer_note` — **all-or-nothing**: satu gagal → 400, tak ada write.

### Dalam `withTransaction` (atomik, + rollback-audit di catch):
1. **Supersede:** `SELECT id FROM rdt.uploads WHERE dinas_code=$1 AND period=$2 AND status='ACTIVE' **FOR UPDATE**`
   (lock, cegah dua persist konkuren). Kalau ada prior: query txn-nya `EXISTS(ledger_entries)` → `evaluateSupersede`.
   - **Blocked** (ada ledger) → **409** (rollback), sebut `blocking_transaction_ids` + `prior_upload_ids`. **Jangan** sentuh apa pun.
2. `INSERT rdt.uploads (dinas_code, uploaded_by_user_id, original_filename, description, row_count_total, period)` → `uploadId`.
3. Kalau ada prior (tak blocked): `UPDATE uploads SET status='SUPERSEDED', superseded_by_upload_id, superseded_at`;
   `UPDATE transactions SET status='SUPERSEDED'` untuk `supersedeIds`; audit `UPLOAD_SUPERSEDED`.
4. Kalau ada file: `saveOriginalFile` via **StorageService** → `UPDATE uploads.original_file_path`.
5. **Duplicate:** kumpulkan `document_no` dari row PENDING → query existing transactions by `document_no` → `flagDuplicates`.
6. **Chunked INSERT ke `rdt.transactions`** — param cap Postgres 65535, chunk = `floor(60000/jumlahKolom)`; semua chunk
   dalam SATU transaksi (tetap atomik). `is_reversal` = `nominal < 0`. Kumpulkan `insertedRows` (id, dinas_inisiasi, dinas_target).
   - **⚠️ Kolom INSERT nyesuai FormatCboRow (Batch 1), BUKAN 65 kolom lama.** Isi hanya field yang parser Format CBO
     hasilkan (account, profit_ctr, ref_doc, period, text_desc, material, in_pclc, curr) + standar
     (upload_id, dinas_inisiasi, dinas_target, nominal, category, status_konfirmasi, is_reversal, invalid_reason,
     sheet_name/raw_row_index bila ada, remark, raw_payload, sub_group, reviewer_note). Kolom contract mati (cost_ctr,
     document_no, sales_doc, wbs_elem, dst) **jangan di-INSERT** — default NULL. *(Konsekuensi: natural-key duplicate
     jadi lebih ramping; itu wajar, port apa adanya.)*
7. **Description → komentar+notif:** satu komentar **top-level** (`parent_comment_id=NULL`) per `dinas_target` distinct
   (skip self-repost: `dinas_target==dinas_inisiasi`), anchor ke salah satu txn pasangan itu; notif = `filterMentionsToPair`
   ∪ PIC ber-dinas target, minus author. (Boleh pakai/variasikan pair-comment helper 3c — di sini SELALU top-level baru.)
8. `COMMIT`. Return `{ inserted, upload_id, duplicates_flagged, superseded_upload_ids, superseded_transaction_count }`.

## Acceptance (HTTP nyata lawan rdt_dev + unit test; bersihkan data uji)
- [ ] Part 0: 3 suite test persist hijau (logika identik).
- [ ] Upload baru → row `uploads` + `transactions` kebentuk (status dari parse dipertahankan); `period` = bulan lalu otomatis.
- [ ] Re-upload (dinas,period) sama, prior **tanpa ledger** → prior jadi SUPERSEDED (uploads+txns), audit `UPLOAD_SUPERSEDED`.
- [ ] Re-upload saat prior punya baris **CONFIRMED (ada ledger)** → **409 block**, nol perubahan.
- [ ] Duplikat cross-upload (document_no cocok) → row PENDING jadi NEEDS_REVIEW + reason; within-file bukan duplikat.
- [ ] File besar (>~1000 baris) → chunked tapi tetap **satu transaksi** (gagal di tengah → nol row masuk).
- [ ] `reviewer_note` satu baris kepanjangan → **400, tak ada write** (all-or-nothing).
- [ ] File asli tersimpan via StorageService & bisa di-download; `sanitizeFilename` blok path-traversal.
- [ ] description → 1 komentar top-level per dinas_target + notif ter-scope (privacy-fix). 105 test lama hijau; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope
- Export/Format TAB → batch export berikutnya. Dashboard, listing komentar/notifikasi penuh → Batch 5.
- `share-cost` → batch tersendiri.

## Setelah selesai
Laporkan: struktur (Part 0 modul + Part 1 endpoint), hasil tiap acceptance (khususnya **supersede block-on-ledger**,
duplicate flag, chunked-atomic), kolom yang di-INSERT (konfirmasi nyesuai FormatCboRow), 105 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0.
