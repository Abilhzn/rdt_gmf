# PROMPT — Batch 4b: Export — POST confirm 🔴 (atomik: batch + subdoc + comment/notif)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 4).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 150 test yang sudah hijau.**
> Sumber: `POST /api/export-batches/confirm` di `rdt/backend/src/routes/exportBatches.js` (port faithful).
> Reuse dari batch lain: `withTransaction`, `RollbackAuditService` (3c), `resolveMentionedUserIds`/
> `filterMentionsToPair` (3a), `DirectoryProvider` (3b), `validateFreeText` (3a). Modul 4a
> (`ExportService`, `BLOCKING_STATUSES`/`ATTACHABLE_STATUSES`) — reuse konstanta, jangan tulis ulang.
>
> 🔴 Zona transaksi finansial: batch = kumpulan transaksi yang resmi "sudah direpost ke SAP".
>
> ⚠️ **JANGAN pakai `PairCommentService` (3c) untuk closing_description di sini.** Kode lama SELALU
> bikin comment **top-level baru** (`parent_comment_id: NULL`), tidak pernah cek/reply thread lama —
> beda dari `PairCommentService` yang reply-kalau-ada-thread. Port logic resolusi-penerima (mention ∪
> dinas_target, minus author) sebagai kode sendiri di service ini; JANGAN panggil `PairCommentService.post()`.

## Endpoint: `POST repost/export/confirm` — TAB-only (`RolesGuard`)

Body: `{ dinas_inisiasi, dinas_target, closing_description?, subdoc_number, transaction_ids? }`.

**Pra-transaksi (400, jangan buka transaksi):**
- `dinas_inisiasi`/`dinas_target` wajib.
- `validateFreeText(closing_description)` (3a) — opsional TAPI kalau diisi, tetap kena length-cap.
- `subdoc_number` wajib (trim, non-empty) — **representasi "sudah post ke SAP", bukan sekadar approval**.

**Transaksi (`withTransaction`) — atomik semuanya:**
1. **Gate (defensif, re-check server-side):** `SELECT COUNT(*) FROM transactions WHERE dinas_inisiasi=$1
   AND dinas_target=$2 AND export_batch_id IS NULL AND status_konfirmasi=ANY(BLOCKING_STATUSES)`.
   `count>0` → throw 400 (`"<n> transaksi <inisiasi>→<target> masih PENDING/DECLINED/NEEDS_REVIEW — belum bisa confirm"`).
2. **`INSERT export_batches(dinas_inisiasi, dinas_target, closing_description, confirmed_by_user_id, confirmed_at=now())
   RETURNING id`** → `batchId`.
3. **Attach baris ATTACHABLE:** `UPDATE transactions SET export_batch_id=$1 WHERE dinas_inisiasi=$2 AND
   dinas_target=$3 AND status_konfirmasi=ANY(ATTACHABLE_STATUSES) AND export_batch_id IS NULL RETURNING id`.
   `rowCount==0` → throw 400 (`"Tidak ada transaksi CONFIRMED/BORNE_BY_INITIATOR untuk <inisiasi>→<target> — tidak ada yang bisa di-confirm"`).
4. **Subdoc pertama, SAMA transaksi:** tentukan `subdocTargetIds` — kalau `transaction_ids` diberi, validasi
   **subset** dari baris yang baru di-attach di langkah 3 (invalid → throw 400 dengan id yang salah); kalau
   tidak, default = semua baris yang baru di-attach. `INSERT export_subdocs(batch_id, subdoc_number)
   RETURNING id` → `UPDATE transactions SET subdoc_id=$1 WHERE id=ANY(subdocTargetIds)`.
5. **Comment top-level baru + notifikasi (logic sendiri, BUKAN PairCommentService — lihat ⚠️ di atas):**
   - `commentBody = closing_description || "Repost <inisiasi> → <target> dikonfirmasi oleh TAB (subdoc <subdoc_number>)."`
     (comment WAJIB ada body — fallback ini yang bikin notifikasi tetap terkirim walau TAB tak menulis apa-apa).
   - `anchorId` = id **terbesar** di antara baris yang baru di-attach (langkah 3).
   - `INSERT comments(transaction_id=anchorId, parent_comment_id=NULL, author_user_id, body=commentBody) RETURNING id`.
   - Penerima = `filterMentionsToPair(resolveMentionedUserIds(commentBody, directory), directory, [dinas_inisiasi, dinas_target])`
     **∪** semua user directory ber-`dinas == dinas_target` (uppercase-match), **minus author**.
   - `INSERT notifications(recipient_user_id, comment_id)` untuk tiap penerima. Kumpulkan `notified_user_ids`.
6. **2 audit_log:** `EXPORT_BATCH_CONFIRM` (`status_before:'WAITING'`, `status_after:'CONFIRMED'`, detail
   `{batch_id, dinas_inisiasi, dinas_target, closing_description, attached_count, notified_user_ids}`) DAN
   `SUBDOC_ADDED` (`status_before/after:'CONFIRMED'`, detail `{batch_id, dinas_inisiasi, dinas_target,
   subdoc_number, transaction_ids: subdocTargetIds}`).
7. `COMMIT`. Response: `{ batch_id, attached_count, notified_user_ids, subdoc_number }`.

**Gagal:** `withTransaction` rollback otomatis. Di `catch`: `RollbackAuditService` (koneksi terpisah, 3c) →
throw domain exception (400 untuk gate/validasi, bawa `error_category`).

## DTO (`class-validator`)
`dinas_inisiasi: string` (required), `dinas_target: string` (required), `closing_description?: string`,
`subdoc_number: string` (required, non-empty setelah trim — validasi kosong-setelah-trim di service,
bukan cuma `@IsNotEmpty` DTO, karena `"   "` lolos `@IsNotEmpty`), `transaction_ids?: number[]`.

## Acceptance (HTTP nyata lawan `rdt_dev`, siapkan 1 pasangan siap-confirm dulu via alur 3b/3c;
data uji dibersihkan balik ke seed setelahnya)
- [ ] Pasangan dengan sisa PENDING → confirm ditolak 400 dengan pesan jumlah transaksi blocking.
- [ ] Pasangan siap (nol BLOCKING, ada ATTACHABLE) → 200, `batch_id` baru, **semua** baris ATTACHABLE pasangan
  itu ter-attach (`export_batch_id` terisi) **dan** ter-cover subdoc pertama (`subdoc_id` terisi) — cek di DB.
- [ ] `closing_description` kosong → comment tetap dibuat pakai fallback text, notifikasi tetap terkirim ke
  `dinas_target`.
- [ ] `closing_description` ada, dengan @mention dinas lain (bukan pasangan ini) → mention itu **tidak** ikut
  notified (privacy-fix, sama prinsip 3b/3c).
- [ ] `transaction_ids` subset custom → hanya id itu yang ter-cover subdoc pertama; sisanya `export_batch_id`
  terisi tapi `subdoc_id` NULL (siap buat subdoc tambahan di 4c).
- [ ] `transaction_ids` berisi id di luar batch yang baru di-attach → 400.
- [ ] **Atomicity 🔴:** paksa gagal di tengah (mis. `subdoc_number` valid tapi injeksi error di langkah 5) →
  **nol** perubahan tersisa (batch/attach/subdoc semua rollback), rollback-audit tetap tercatat.
- [ ] Non-TAB → 403.
- [ ] Comment yang dibuat **top-level baru** (`parent_comment_id IS NULL`) — BUKAN reply ke thread lama
  pasangan itu (verifikasi eksplisit, ini beda sengaja dari `PairCommentService`).
- [ ] **150 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope (→ 4c)
- `POST :batchId/subdocs` (subdoc tambahan/overflow). `GET history`.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya atomicity & bukti comment top-level-baru),
konfirmasi 150 test lama hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 4b ✅.
