# PROMPT — Batch 4a: Export — Baca-saja (waiting / lines / transparency / download)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 4).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 137 test yang sudah hijau.**
> Sumber: `rdt/backend/src/routes/exportBatches.js` (port faithful, HANYA bagian baca-saja).
> **Tak ada tulis DB di batch ini** — semua endpoint di sini read-only.
>
> ⚠️ **Format TAB 8-kolom SAJA.** Format 53-kolom "contract" lama (`CONTRACT_FIELDS`,
> `buildContractWorkbookBuffer`) **DIBUANG total** — JANGAN diport, parser sudah Format CBO
> sehingga kolom itu yatim. Semua endpoint export di sini HANYA menghasilkan Format TAB.

## Model kunci (baca dulu, port apa adanya)

- `BLOCKING_STATUSES = ['PENDING','DECLINED','NEEDS_REVIEW']`, `ATTACHABLE_STATUSES = ['CONFIRMED','BORNE_BY_INITIATOR']`.
  EXCLUDED/NEEDS_INVESTIGATION sengaja di luar dua-duanya (tak pernah masuk hitungan waiting/export).
- **WAITING = computed**, bukan tabel — satu entri per pasangan `(dinas_inisiasi, dinas_target)` yang
  baris `export_batch_id IS NULL`-nya semuanya ATTACHABLE (nol yang BLOCKING).
- **Overdue = sticky**: bandingkan `periode_efektif` (MAX per pasangan) vs periode declared
  ter-mayoritas pasangan itu; kalau beda → overdue permanen (periode_efektif tak pernah "balik").
- **Tak ada state EXPORTED** — download stateless & repeatable, tersedia sebelum batch/confirm ada.

## Tugas — port 5 endpoint (`modules/repost/export/`), semua **TAB-only** (`RolesGuard`+`@Roles('TAB')`)

1. **GET `waiting`** — query `rdt.transactions` `WHERE export_batch_id IS NULL AND dinas_target IS NOT NULL
   AND status_konfirmasi = ANY(BLOCKING ∪ ATTACHABLE)`, JOIN `uploads` (buat `declared_period`). Agregasi
   per pasangan di kode (bukan SQL GROUP BY — port pola `byPair` accumulator apa adanya): `blocked` (ada
   baris BLOCKING), `total` (hitung ATTACHABLE), `periodCounts`, `maxPeriodeEfektif`. Filter hasil ke
   `!blocked && total>0`, urut `(dinas_inisiasi+dinas_target)`. `overdue` = periode-mayoritas vs
   `maxPeriodeEfektif` beda. Sertakan `deriveStateLabel` (3a) di tiap entri (baca signature-nya, `pendingCount:0`).

2. **GET `:batchId/lines`** — `SELECT t.id,account,nominal,remark,ref_doc,subdoc_id,s.subdoc_number
   FROM transactions t LEFT JOIN export_subdocs s ON s.id=t.subdoc_id WHERE t.export_batch_id=:batchId ORDER BY t.id`.

3. **GET `transparency/:dinasInisiasi/:dinasTarget`** — `SELECT * FROM transactions WHERE dinas_inisiasi=$1
   AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi=ANY(BLOCKING∪ATTACHABLE) ORDER BY id`.
   (`SELECT *` sengaja — preview harus ikut semua kolom transaksi apa adanya, bukan daftar manual.)

4. **GET `export/:batchId`** — ambil `dinas_inisiasi/dinas_target` dari `export_batches` (404 kalau tak ada),
   lalu `SELECT dinas_inisiasi,dinas_target,account,nominal,curr,ref_doc,period FROM transactions
   WHERE export_batch_id=:batchId AND status_konfirmasi='CONFIRMED' ORDER BY id` → stream Format TAB.

5. **GET `export-pair/:dinasInisiasi/:dinasTarget`** — sama seperti #4 tapi baca langsung dari pasangan
   (`export_batch_id IS NULL AND status_konfirmasi='CONFIRMED'`, tanpa batch — pure read, tak ada state berubah).

### Builder Format TAB (`buildFormatTabWorkbookBuffer`, port dari kode lama — port apa adanya)

8 kolom: `Requester`(=dinas_inisiasi), `Cost.Element`(=account), `Amount`(=nominal), `Curr.`(=curr),
`Recipient`(=dinas_target), `Qty`(konstan `1`), `UoM`(konstan `'EA'`), `"Text "`(header **dengan trailing
space, verbatim** dari template resmi — literal concat 4 field: `` `${dinas_inisiasi} to ${dinas_target} ${ref_doc} ${period}` ``).
Bungkus ExcelJS di service ini (Boundaries, konsisten parser Batch 1).

### Streaming + chunking (port `streamContractExport`, disederhanakan — hapus parameter `format`,
selalu Format TAB)

`MAX_ROWS_PER_FILE = 300`. `≤300` baris → satu `.xlsx` attachment (`{dinasInisiasi}-{dinasTarget}_{tanggal}_FormatTAB.xlsx`).
`>300` → potong per 300, tiap potongan `.xlsx` terpisah, di-zip (JSZip) jadi satu `.zip` (`chunk-1.xlsx`, `chunk-2.xlsx`, ...),
urutan **tetap** `ORDER BY id` (slice, bukan re-sort) — biar "file 1" selaras "subdoc 1" (dipakai TAB di 4c nanti).

## Acceptance (HTTP nyata lawan `rdt_dev`; TAB-only → uji 403 non-TAB di tiap endpoint)
- [ ] `waiting` mengembalikan pasangan yang seluruh baris-nya ATTACHABLE (nol BLOCKING); pasangan dengan
  sisa PENDING **tidak** muncul; `overdue:true` untuk pasangan yang `periode_efektif` pernah bergeser.
- [ ] `:batchId/lines`, `transparency/...` mengembalikan baris sesuai kondisi di atas.
- [ ] Download (`export/:batchId` & `export-pair/...`) 8-kolom Format TAB **persis** (nama kolom, `"Text "` trailing
  space, `Qty=1`, `UoM='EA'`), hanya baris `CONFIRMED`. Uji ≤300 → `.xlsx`; siapkan/uji ≥301 baris → `.zip`
  berisi beberapa `.xlsx` berurutan (boleh pakai data uji sintetis untuk kasus zip kalau `rdt_dev` tak
  punya pasangan >300 baris CONFIRMED — sebutkan di laporan kalau begitu).
- [ ] Non-TAB → 403 di kelima endpoint.
- [ ] **137 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.
- [ ] **Tidak ada** kode terkait format 53-kolom/`CONTRACT_FIELDS` ikut ter-port.

## Di luar scope (→ 4b/4c)
- `POST confirm`, `POST :batchId/subdocs` (tulis DB) → 4b/4c.
- `GET history` → 4c.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya contoh nyata waiting+overdue, dan hasil zip-chunking),
konfirmasi 137 test lama hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 4a ✅.
