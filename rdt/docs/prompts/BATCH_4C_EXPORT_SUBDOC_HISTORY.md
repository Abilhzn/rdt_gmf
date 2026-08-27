# PROMPT — Batch 4c: Export — Subdoc Overflow + History (penutup Batch 4)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 4).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 161 test yang sudah hijau.**
> Sumber: `POST /:batchId/subdocs` + `GET /history` di `rdt/backend/src/routes/exportBatches.js`
> (port faithful). Reuse `withTransaction`, `RollbackAuditService` (3c), `deriveStateLabel` (3a),
> konstanta `ATTACHABLE_STATUSES` (4a) kalau relevan.
>
> Ini **penutup Batch 4** — begitu ini kelar, seluruh `repost/export` tuntas.

## 1. `POST repost/export/:batchId/subdocs` — TAB-only (`RolesGuard`)

Kasus **overflow**: satu pasangan yang CONFIRMED-nya >300 baris tak bisa dicover 1 subdoc (cap SAP)
— rute ini nambah subdoc **kedua dst** ke batch yang sudah ada (batch pertama+subdoc pertama dibuat
atomik di `POST confirm`, 4b). Body: `{ subdoc_number, transaction_ids? }`.

**Transaksi (`withTransaction`) sendiri (terpisah dari 4b):**
1. `subdoc_number` wajib (trim non-empty) → 400 kalau kosong.
2. `SELECT id, dinas_inisiasi, dinas_target FROM export_batches WHERE id=$1` — tak ada → throw (batch not found).
3. `unassignedIds = SELECT id FROM transactions WHERE export_batch_id=:batchId AND subdoc_id IS NULL` (Set).
4. `targetIds`: kalau `transaction_ids` diberi → **wajib subset** dari `unassignedIds` (id yang tak eligible →
   throw dengan daftar id yang salah, pesan sebut "not in this batch, or already covered by another subdoc");
   kalau tidak diberi → default = **semua** `unassignedIds`.
5. `targetIds` kosong (semua baris batch ini sudah tercover subdoc lain) → throw ("no unassigned transactions to cover").
6. `INSERT export_subdocs(batch_id, subdoc_number) RETURNING id, subdoc_number, created_at` → `subdocId`.
7. `UPDATE transactions SET subdoc_id=$1 WHERE id=ANY(targetIds)`.
8. `INSERT audit_log` action `SUBDOC_ADDED` (`status_before/after:'CONFIRMED'`, detail
   `{batch_id, dinas_inisiasi, dinas_target, subdoc_number, transaction_ids: targetIds}`).
9. `COMMIT`. Response: `{ subdoc: { id, subdoc_number, created_at, transaction_ids: targetIds } }`.

Gagal → rollback + `RollbackAuditService`, throw domain exception (400 untuk kasus validasi di atas).

## 2. `GET repost/export/history` — **BUKAN TAB-only** (beda dari semua endpoint 4a/4b)

Otorisasi khusus (bukan `RolesGuard` biasa — port logic-nya sendiri):
- `role === 'TAB'` → lihat **semua** batch.
- Selain TAB → **force-scoped** ke `dinas_inisiasi = user.dinas` (server-side, **tak ada** query param
  dinas yang diterima dari caller non-TAB — jangan buka celah bypass ini).

Query opsional: `?periode=YYYY-MM`.

**Langkah (read-only, tanpa transaksi):**
1. `WHERE EXISTS (SELECT 1 FROM export_subdocs s WHERE s.batch_id=b.id)` — batch tanpa subdoc sama sekali
   **tidak muncul** (mustahil sejak 4b: tiap batch lahir dengan subdoc pertama, tapi tetap port guard-nya).
   Tambah filter dinas kalau non-TAB (lihat di atas). `ORDER BY confirmed_at DESC`.
2. Per batch, ambil semua subdoc-nya + `transaction_ids` yang di-cover tiap subdoc:
   `LEFT JOIN transactions ON t.subdoc_id=s.id`, `array_agg(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL)`,
   `GROUP BY s.id`, urut `created_at ASC, id ASC`.
3. **Derive `period` per batch** (declared): dari `transactions JOIN uploads`, `GROUP BY batch_id, period`,
   **periode ter-mayoritas (modus)** yang menang (bukan yang pertama/terbaru) — port `ORDER BY c DESC, period DESC` + ambil baris pertama per batch.
4. **Derive `period_efektif` per batch**: `MAX(periode_efektif)` across transaksi batch itu; NULL → fallback ke `period`.
5. `overdue = period && period_efektif && period_efektif !== period`.
6. `state_label = deriveStateLabel({ pendingCount:0, targetDinas: b.dinas_target, subdocNumbers })` (3a — cek
   signature persis, ada param `subdocNumbers` di sini beda dari pemakaian `waiting` di 4a yang tanpa itu).
7. **Filter `periode`** (kalau ada di query) **SETELAH** derivasi (bandingkan `period_efektif || period`), bukan di WHERE SQL.
8. Response: `{ batches: [...] }` (tiap batch = row asli + `period`, `period_efektif`, `overdue`, `subdocs`, `subdoc_numbers`, `state_label`).

## Acceptance (HTTP nyata lawan `rdt_dev`; data uji dibersihkan balik ke seed setelahnya)
- [ ] **Overflow:** siapkan batch dari 4b dengan `transaction_ids` subset (sisa baris `subdoc_id` NULL) →
  `POST :batchId/subdocs` tanpa `transaction_ids` → subdoc kedua nge-cover **sisa** baris itu saja
  (default ke unassigned, bukan semua baris batch).
- [ ] `transaction_ids` custom yang **sudah** tercover subdoc lain → 400 (bukan diam-diam re-cover / double-count).
- [ ] Batch yang sudah 100% tercover (tak ada unassigned) → `POST :batchId/subdocs` → 400 "no unassigned transactions to cover".
- [ ] Non-TAB → 403 di `POST :batchId/subdocs`.
- [ ] **History TAB** → lihat batch lintas dinas (bukan cuma satu inisiator).
- [ ] **History non-TAB** → hanya batch dengan `dinas_inisiasi == user.dinas` miliknya sendiri, **walau** dicoba
  kasih parameter dinas lain manapun (buktikan tak ada bypass).
- [ ] `overdue:true` untuk batch yang `period_efektif` pernah bergeser dari `period` declared-nya (reuse skenario
  overdue dari 4a kalau memungkinkan, atau bikin baru).
- [ ] Filter `?periode=YYYY-MM` mengecualikan batch yang `period_efektif||period`-nya beda.
- [ ] Batch dengan 2 subdoc (dari test overflow di atas) → `subdocs` array berisi 2 entri urut `created_at`,
  masing-masing `transaction_ids`-nya benar (union keduanya = semua baris batch).
- [ ] **161 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya overflow default-ke-unassigned, history
scoping non-TAB tanpa-bypass, dan overdue+periode filter), konfirmasi 161 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 4c ✅ (**Batch 4 tuntas**).
