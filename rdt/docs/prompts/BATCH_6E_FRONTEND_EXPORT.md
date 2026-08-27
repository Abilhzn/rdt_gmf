# PROMPT — Batch 6e: Frontend — Export (need-approval/ + repost-history/)

> Tempel ke agent eksekutor. Jalankan SETELAH 6a. Independen dari 6b/6c/6d/6f, boleh paralel.
> Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 6). Backend & `auth/frontend/` **JANGAN diubah**.

## Konteks

**Koreksi nama vs isi** (temuan grounding): `need-approval/` BUKAN reassignment/investigation
(sudah ditangani 6c via `confirm/`) — ini flow TAB "**waiting to repost**": waiting queue,
transparency preview, dan confirm-batch (bikin `export_batches`+subdoc pertama sekaligus). Sumber:
`rdt/frontend/rdt/need-approval/need-approval.component.ts` (+html/scss/module) +
`rdt/frontend/rdt/repost-history/` (riwayat batch, TAB lihat semua / PIC lihat punya sendiri).
Backend: `modules/repost/export/` (Batch 4a baca-saja, 4b confirm, 4c subdoc-overflow+history).

**Kontrak backend-nest (sudah pasti):**
- `GET repost/export/waiting` (TAB-only) → array per pasangan: `{dinas_inisiasi, dinas_target,
  total, overdue, state_label, ...}`. **Computed, bukan tabel** — entri hilang begitu 100% resolved
  DAN semua ter-subdoc (masuk ke history, bukan waiting lagi).
- `GET repost/export/:batchId/lines`, `GET repost/export/transparency/:dinasInisiasi/:dinasTarget`
  (preview sebelum confirm, `SELECT *` — banyak field, tampilkan yang relevan saja).
- `GET repost/export/export/:batchId` & `GET repost/export/export-pair/:dinasInisiasi/:dinasTarget`
  — **download** Format TAB. Response bisa `.xlsx` (≤300 baris) ATAU `.zip` berisi beberapa
  `chunk-N.xlsx` (>300 baris, cap SAP). **UI harus menangani dua kasus** — kalau >300 baris, TAB
  perlu isi **beberapa nomor subdoc sekaligus** (satu per chunk) saat confirm (lihat di bawah).
  Pakai `triggerBlobDownload`/`filenameFromResponse` yang sudah ada di `confirmation.service.ts`
  lama (util genuinely reusable, bukan spesifik ke confirmation — pertimbangkan pindah ke
  `shared/`/`core/` saat restrukturisasi).
- `POST repost/export/confirm` (TAB-only) — body `{dinas_inisiasi, dinas_target,
  closing_description?, subdoc_number, transaction_ids?}`. **Satu call = create batch + attach +
  subdoc PERTAMA sekaligus** (atomik, bukan dua langkah).
- `POST repost/export/:batchId/subdocs` (TAB-only) — subdoc TAMBAHAN untuk sisa baris >300 yang
  belum tercover subdoc pertama (`transaction_ids` opsional, default ke sisa unassigned). **Inilah
  mekanisme "Repost 1: [subdoc]", "Repost 2: [subdoc]"** yang disebut di komentar lama
  (`chunkCount`/`chunkIndexes`) — form multi-subdoc-input untuk kasus zip.
- `GET repost/export/history` — **BUKAN TAB-only**. TAB lihat semua batch (tanpa query param
  dinas), PIC lihat cuma miliknya (auto-scoped server, **jangan** kirim query param dinas dari
  frontend non-TAB — backend abaikan itu, sekalian jangan render input untuk itu supaya tak
  menyesatkan). Response per-batch termasuk `subdocs[]` + `transaction_ids` per subdoc + `overdue`
  + filter `?periode=`.

## Tugas

1. **`features/export/`**: `pages/waiting-page.component.ts` (SMART, `need-approval/` lama, TAB-only
   route), `pages/history-page.component.ts` (SMART, `repost-history/` lama, akses semua role),
   `components/` (DUMB — waiting-list-item, transparency-panel, confirm-form dgn multi-subdoc-input
   utk kasus zip, history-table dgn subdoc-breakdown), `services/export.service.ts` (gabung
   `export-batch.service.ts` lama, endpoint sesuai kontrak di atas).
2. **Baca `need-approval.component.ts` ASLI utuh dulu** — komentar di kepala file sudah menjelaskan
   model chunk/subdoc dengan detail, jangan reimplementasi dari nol tanpa baca itu.
3. Pastikan `history-page` **tidak** expose dinas-picker untuk non-TAB (scoping server-side sudah
   benar, tapi UI seharusnya konsisten — non-TAB tak perlu lihat filter dinas sama sekali).
4. `triggerBlobDownload`/`filenameFromResponse` — pindah ke lokasi shared (`core/` atau
   `shared/utils/`) kalau memang dipakai lintas fitur (export + mungkin persist original-file
   download di 6b) — cek dulu apakah 6b sudah butuh util serupa untuk download original file.

## Acceptance
- [ ] Waiting list (TAB) menampilkan pasangan siap confirm, overdue badge benar.
- [ ] Download `.xlsx` (kasus ≤300) & `.zip` (kasus >300, kalau ada data ujinya) sama-sama jalan.
- [ ] Confirm-batch: form closing_description + subdoc_number → sukses → entri hilang dari waiting,
  muncul di history.
- [ ] Kasus subdoc overflow: setelah confirm pertama, ada UI untuk tambah subdoc kedua ke sisa baris.
- [ ] History: TAB lihat lintas dinas, PIC lihat cuma miliknya — TANPA cara memaksa lihat dinas lain
  dari sisi UI.
- [ ] `ng build`/lint bersih. Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: struktur `features/export/` final, field response yang dikonfirmasi dari source,
keputusan lokasi util blob-download. Update tracker §0 → Batch 6e ✅.
