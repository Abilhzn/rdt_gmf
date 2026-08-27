# PROMPT — Batch 5.5b: Share Cost Split (penutup Batch 5.5)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 5.5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 238 test yang sudah hijau.**
> Sumber: `rdt/backend/src/routes/shareCost.js` (port faithful — TAB-only, seluruh router).
> Reuse: `buildValidCodeMap`, `validateFreeText` (3a), `resolveMentionedUserIds`/`filterMentionsToPair`
> (3a), `withTransaction`+`RollbackAuditService` (3c). Skema sudah siap — `SPLIT_VOID` status &
> `split_from_transaction_id` kolom sudah ada dari migration `012_share_cost_split.sql` (sudah di-port
> Batch 0.5), **tak perlu migration baru**.
>
> Ini **penutup Batch 5.5** — begitu ini kelar, semua fitur backend yang kelewat dari rencana awal tuntas.

## Konteks

TAB bisa membelah **satu baris PENDING** jadi beberapa baris `(dinas_target, nominal)` berbeda (mis.
100rb ke TH → 35rb TH + 65rb TU). **Locked ke PENDING-only** (baris CONFIRMED sudah punya
`ledger_entries`, butuh desain reversal terpisah — di luar scope). Baris asli ditandai `SPLIT_VOID`
(mati permanen dari semua alur aktif), baris hasil split PENDING baru dengan `split_from_transaction_id`
menunjuk baris asli.

## 1. `GET share-cost/candidates` — TAB-only

Query opsional `?q=`. `WHERE status_konfirmasi='PENDING' AND dinas_target='TAB'` (literal exact match,
bukan join `is_active` — nilai `dinas_target` yang tersimpan). `q` → `ILIKE` di `account`/`ref_doc`/`remark`
(param sama dipakai 3x). JOIN `uploads` (`original_filename`). `ORDER BY created_at DESC LIMIT 100`.

## 2. `POST share-cost/:transactionId/split` — TAB-only

Body `{ splits: [{ dinas_target, nominal }, ...], note }`.

**Pra-transaksi (400, jangan buka transaksi):**
- `validateFreeText(note, {required:true})` (3a) — **wajib**, alasan split masuk audit trail.
- `splits` harus array, **minimal 2 baris**.
- Tiap split wajib `dinas_target` + `nominal` (number, finite, **≠ 0** — boleh negatif, port apa adanya
  jangan tambah pembatasan tanda yang tak ada di kode lama).

**Transaksi (`withTransaction`):**
1. `SELECT id,status_konfirmasi,dinas_inisiasi,dinas_target,nominal FROM transactions WHERE id=$1
   FOR UPDATE`. Tak ada → throw. `status_konfirmasi !== 'PENDING'` → throw (sebutkan status sekarang
   di pesan).
2. **Validasi dinas per split**: `SELECT code FROM dinas WHERE is_active=true` → `buildValidCodeMap`
   (3a) → resolve tiap `split.dinas_target` ke kode kanonik tersimpan (case-insensitive match, tapi
   simpan **case asli** dari tabel — `dinas` punya kode campur-case mis. `'Corp'`); tak dikenal → throw.
   **Timpa** `split.dinas_target` dengan hasil resolve ini (dipakai lagi di INSERT langkah 4).
3. **Validasi SUM nominal** — bandingkan dalam **sen (integer)**, bukan float:
   `originalCents = round(original.nominal*100)`, `sumCents = Σ round(split.nominal*100)`.
   `sumCents !== originalCents` → throw (pesan sebutkan dua-duanya, format 2 desimal).
4. `UPDATE transactions SET status_konfirmasi='SPLIT_VOID' WHERE id=:originalId`.
5. **Per split — INSERT...SELECT copy-forward SEMUA kolom non-override dari baris asli** (port
   PERSIS daftar kolom kode lama — skema sudah terverifikasi punya semua kolom ini dari `schema.sql`
   yang di-port utuh Batch 0.5; sebagian besar kolom "contract lama" akan NULL karena parser Format CBO,
   itu diharapkan, sama seperti pola `persist` 3.5b/duplicate-check 3.5a):
   `INSERT INTO transactions (upload_id, dinas_inisiasi, dinas_target, nominal, category,
   status_konfirmasi, is_reversal, invalid_reason, account, cost_ctr, profit_ctr, partner_pc,
   document_no, ref_doc, period, text_desc, acc_text, sap_user, sales_doc, wbs_elem, purch_doc,
   order_no, fiscal_year, elim_prctr, obj_class, customer, vendor, plant, material, time_val, year_2,
   ref_org_un, val_a, mvt, type, sales_ord, s_no, bus_a, func_area, acty, asset, rep_mat, ar, dt,
   ref_tran, item, bill_t, sd_doc, s_grp, s_off, co_ar, in_pclc, curr, doc_date, pstng_date, in_ccc,
   in_tc, qty, unit, entry_dte, value_date, sheet_name, raw_row_index, remark, raw_payload, sub_group,
   split_from_transaction_id) SELECT upload_id, dinas_inisiasi, $2 (dinas_target resolved),
   $3 (nominal), category, 'PENDING', is_reversal, invalid_reason, ...(sisa kolom sama persis,
   copy-forward)..., $1 (split_from_transaction_id = originalId) FROM transactions WHERE id=$1
   RETURNING id`. Kumpulkan `newIds`.
6. `INSERT audit_log` action `SPLIT_BY_TAB` (`status_before:'PENDING'`, `status_after:'SPLIT_VOID'`,
   detail `{split_into:newIds, note, splits}`).
7. **Comment + notifikasi di thread PASANGAN ASLI** (`dinas_inisiasi` → `dinas_target` **ASLI** = `'TAB'`,
   BUKAN target hasil split manapun): cari komentar top-level terakhir pasangan itu
   (`parent_comment_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`) — ada → reply (anchor =
   `transaction_id` milik parent itu, `parent_comment_id`=parent.id); tak ada → top-level baru anchor
   ke `originalId`. ⚠️ **Cek dulu apakah logic "cari root pasangan, reply-kalau-ada, else top-level
   baru" ini SAMA PERSIS dengan `PairCommentService` (3c)** — kalau ordering/tie-break-nya identik,
   **REUSE `PairCommentService`** di sini (ini kandidat pertama yang genuinely cocok, beda dari 4b/5c
   yang sengaja divergen — verifikasi dulu sebelum reuse, jangan asumsi). `commentBody =
   "[Share-Cost split oleh TAB] Baris ini dibelah jadi: ${splits.map(s=>`${dinas_target} ${nominal}`).join(', ')}. ${note}"`.
   Penerima: `filterMentionsToPair(resolveMentionedUserIds(commentBody,directory), directory,
   [dinas_inisiasi, dinas_target_ASLI])` **∪** semua user directory ber-`dinas==dinas_target_ASLI`
   (uppercase), **minus** author.
8. `COMMIT`. Response `{ split_from: originalId, split_into: newIds }`.

Gagal → rollback + `RollbackAuditService` (3c), throw domain exception.

## Acceptance (HTTP nyata lawan `rdt_dev`; data uji dibersihkan balik ke seed setelahnya)
- [ ] `candidates` hanya baris PENDING dengan `dinas_target='TAB'` persis; `q` filter jalan di
  account/ref_doc/remark.
- [ ] Split valid (SUM persis sama) → baris asli `SPLIT_VOID`, N baris baru PENDING dengan
  `split_from_transaction_id` benar, kolom Format-CBO (`account`,`ref_doc`,`period`,`text_desc`,
  `in_pclc`,`curr`,`sheet_name`,`raw_row_index`,`remark`,`raw_payload`,`sub_group`) ter-copy-forward
  dari baris asli, kolom contract-lama NULL (diharapkan).
- [ ] SUM nominal split **beda sedikit pun** (mis. selisih 1 sen akibat rounding) dari nominal asli →
  400, **nol perubahan** tersimpan (atomicity).
- [ ] `splits` < 2 baris → 400. Split dengan `dinas_target` tak dikenal/nonaktif → 400.
- [ ] Baris bukan PENDING (mis. sudah CONFIRMED) → 400/409, tak bisa displit.
- [ ] `note` kosong → 400.
- [ ] Comment/notifikasi masuk ke thread pasangan **asli** (initiator→TAB), **bukan** ke pasangan-baru
  hasil split manapun; @mention dinas di luar pasangan asli tak ikut notified.
- [ ] `SPLIT_VOID` **tak pernah muncul** di hasil `waiting`(4a)/`summary`(5b)/`per-dinas-rollup`(5b)/
  `history`(4c) — verifikasi salah satu endpoint itu abis split, baris asli sudah hilang dari situ.
- [ ] Non-TAB → 403 di kedua endpoint.
- [ ] **238 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya cents-precision SUM check, copy-forward
kolom, dan konfirmasi `PairCommentService` reuse-atau-tidak beserta alasannya), konfirmasi 238 test
lama hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 5.5b ✅ (**Batch 5.5 tuntas**).
