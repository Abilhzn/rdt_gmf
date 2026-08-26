# PROMPT — Batch 3.5a: Modul Persist (duplicate / supersede / originalFile)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 3.5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 105 test yang sudah hijau.**
> Pola sama seperti 3a: **port unit kecil & testable DULU**, biar handler persist (3.5b) tinggal ngerakit.

## Konteks

Persist (parse → `rdt.transactions`) ditunda sejak Batch 1 — ini yang bikin backend baru bisa BIKIN
transaksi. 3.5a = tiga modul pendukungnya (2 fungsi murni + 1 sanitasi file). Sumber:
`rdt/backend/src/persist/`. Tiga test-nya = acceptance anchor (spec persisnya ada di test, port apa adanya).

## Tugas: port 3 modul (TypeScript strict, dipecah rapi, logika identik)

1. **`duplicateCheck.js` → `flagDuplicates(rows, existingRows)`** (fungsi murni).
   Menandai baris PENDING yang `document_no`-nya sudah ada di transaksi lain (cross-upload) jadi
   NEEDS_REVIEW + reason. **Port apa adanya.**
   - ⚠️ **Catatan (bukan bug, jangan diubah):** parser Format CBO TIDAK menghasilkan `document_no`,
     jadi fungsi ini praktis **inert** di alur sekarang (tak ada docNo → tak ada yang di-flag).
     Tetap port faithful + biarkan test-nya jalan. **JANGAN ngarang kunci dedup baru** (mis. pindah
     ke ref_doc) — itu keputusan produk terpisah, di luar scope.

2. **`supersedeCheck.js` → `evaluateSupersede(priorTxnRows)`** (fungsi murni) →
   `{ blocked, blockingCount, blockingIds, supersedeIds }`.
   Keputusan block-vs-supersede berdasar **`has_ledger_entry`** (bukan whitelist status) — baca header
   comment modul lama untuk alasannya. **Port apa adanya.**

3. **`originalFile.js` → `saveOriginalFile(...)`** (sanitasi + simpan file).
   - **Pisahkan** logika **sanitasi nama** (bare filename, defense path-traversal — INI yang diuji test,
     fungsi murni) dari operasi **tulis file**. Untuk 3.5a cukup port bagian sanitasi + test-nya hijau.
   - Operasi tulis sebenarnya nanti di 3.5b lewat **StorageService** (bukan `fs` langsung ke uploadDir).
     Sisakan seam yang jelas; jangan hardcode `fs`/path lokal di logika yang di-test.

## Penempatan
`modules/repost/persist/` (mis. `duplicate-check.ts`, `supersede-check.ts`, `original-file.ts`).
Fungsi murni, konsisten dengan gaya 3a (jangan bungkus jadi `@Injectable` gemuk kalau tak perlu DI).

## Port test → Jest (`.spec.ts`)
`duplicateCheck.test.js`, `supersedeCheck.test.js`, `originalFile.test.js` — sesuaikan import + tipe,
logika/assertion tidak berubah. Ini acceptance-nya.

## Acceptance
- [ ] 3 modul ter-port; `flagDuplicates` & `evaluateSupersede` fungsi murni (nol DB/Express/HTTP).
- [ ] Sanitasi `originalFile` murni & teruji (test path-traversal hijau), operasi tulis di-seam ke StorageService (belum diimplement di sini).
- [ ] 3 suite test persist hijau; **105 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope (→ 3.5b)
- Handler `POST persist` (upload row, supersede eksekusi, insert transaksi ter-chunk, komentar).
- `GET uploads/:id/download`. Transaksi/rollback-audit. StorageService write nyata.

## Setelah selesai
Laporkan: lokasi 3 modul, konfirmasi kemurnian + seam sanitasi/tulis, hasil `npm test` (jumlah suite/test).
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3.5a ✅.
