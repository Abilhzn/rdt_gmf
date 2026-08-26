# PROMPT — Batch 5c: Dashboard Detail + Comment Thread (penutup Batch 5 — dashboard)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 192 test yang sudah hijau.**
> Sumber: `GET/POST /detail/:initiatorDinas/:targetDinas[/comments]` di `rdt/backend/src/routes/dashboard.js`
> (port faithful). Reuse: `fetchReassignChainMap` (5b helper), `resolveMentionedUserIds`/`filterMentionsToPair`
> (3a), `validateFreeText` (3a), `DirectoryProvider` (3b, ganti `loadDirectory()` lama), `withTransaction`
> + `RollbackAuditService` (3c) — meski kode lama pakai BEGIN/COMMIT manual, port ke konvensi transaksi
> kita yang konsisten dengan seluruh endpoint tulis lain di codebase ini.
>
> ⚠️ **TIGA pola pembuatan comment berbeda di codebase ini — JANGAN dicampur:**
> 1. `PairCommentService` (3c): reply ke root thread pasangan kalau ada, else top-level baru.
> 2. Export confirm (4b): SELALU top-level baru (`parent_comment_id: NULL`), tak pernah reply.
> 3. **Batch ini (dashboard detail)**: reply KALAU `parent_comment_id` diberi eksplisit oleh caller
>    (inherit `transaction_id` parent-nya, BUKAN dari body); TANPA `parent_comment_id` → top-level baru,
>    anchor ke transaksi ber-**id TERBESAR** dalam pasangan itu. Beda dari #1 (tak auto-cari root lama)
>    DAN dari #2 (bisa reply kalau diminta). **Port sendiri, JANGAN panggil `PairCommentService`.**

## Helper (port ke `modules/dashboard/shared/` — nama beda dari helper 5b biar jelas beda scope)

**`canAccessPair(user, initiatorDinas, targetDinas)`** — `role==='TAB'` → true; else `user.dinas`
(uppercase) harus sama dengan **initiatorDinas ATAU targetDinas** (uppercase) — **PIC di kedua sisi
pasangan boleh akses**, bukan cuma inisiator. Gagal → 403.

**`getPairTransactions(initiatorDinas, targetDinas)`**:
- **Sentinel `targetDinas.toUpperCase()==='INVESTIGATION'`** (case-insensitive): query sederhana
  `SELECT id,account,nominal,status_konfirmasi,ref_doc,remark,dinas_target,reassign_count FROM
  transactions WHERE dinas_inisiasi=$1 AND status_konfirmasi='NEEDS_INVESTIGATION'` — **tanpa** chain
  logic (baris ini `dinas_target IS NULL` by definition, belum pernah dirutekan).
- **Selain itu**: `SELECT ... FROM transactions WHERE dinas_inisiasi=$1 AND dinas_target IS NOT NULL
  AND status_konfirmasi=ANY(ACTIONABLE_STATUSES)`, lalu filter ke baris yang **`dinas_target` SEKARANG
  ATAU salah satu hop di `fetchReassignChainMap`-nya** (case-insensitive) match `targetDinas` — "sekali
  masuk chain, tetap terhitung", sama prinsip `buildChainAwareProgress` (5b). Attach `chain:
  [initiatorDinas, ...hops, dinas_target]` ke tiap baris (breadcrumb PER-TRANSAKSI, beda dari kartu
  agregat 5b yang cuma tampil kalau semua anggota sepakat).

**`getPairCommentThread(pairTransactionIds)`** — `SELECT id,transaction_id,parent_comment_id,
author_user_id,body,created_at FROM comments WHERE transaction_id=ANY($1) ORDER BY created_at ASC, id ASC`
(gabung SEMUA komentar lintas-transaksi pasangan itu jadi satu percakapan kronologis — bukan per-transaksi
terpisah). Lampirkan `author_display_name` via `DirectoryProvider`.

## Endpoint (`modules/dashboard/`, akses via `canAccessPair` — bukan `RolesGuard` biasa, karena
tergantung parameter `:initiatorDinas/:targetDinas` di path)

1. **`GET dashboard/detail/:initiatorDinas/:targetDinas`** —
   `transactions = getPairTransactions(...)`. **Progress dihitung LANGSUNG dari `transactions` di sini**
   (`total/resolved/pending/declined/percent` — **BUKAN** reuse `buildChainAwareProgress` privat dari
   5b, karena pasangan yang dicapai via redirect tak akan match key agregat 5b yang sudah di-collapse).
   `chain` ditampilkan hanya kalau **semua** transaksi sepakat chain yang sama **dan** `length>2`.
   `comments = getPairCommentThread(transactions.map(id))`. Response:
   `{ initiator_dinas, target_dinas, progress, transactions, comments }`.

2. **`GET dashboard/detail/:initiatorDinas/:targetDinas/comments`** — versi ringan (polling): sama
   `getPairTransactions` + `getPairCommentThread`, response `{ comments }` saja.

3. **`POST dashboard/detail/:initiatorDinas/:targetDinas/comments`** — body `{ body, parent_comment_id? }`.
   `validateFreeText(body, required)` (3a) → 400 kalau gagal, **jangan buka transaksi**.
   **Transaksi (`withTransaction`):**
   - `parent_comment_id` diberi → `SELECT transaction_id FROM comments WHERE id=$1`; tak ketemu → throw
     400 ("parent_comment_id not found"). `transactionId` = hasil lookup ini.
   - Tidak diberi → `transactions = getPairTransactions(...)`; kosong → throw 400 ("no transactions exist
     yet for this pair to anchor a comment to"); `transactionId` = **id TERBESAR** di antara mereka.
   - `INSERT comments(transaction_id, parent_comment_id, author_user_id, body) RETURNING id, created_at`.
   - Notifikasi: `filterMentionsToPair(resolveMentionedUserIds(body, directory), directory,
     [initiatorDinas, targetDinas])` minus author → `INSERT notifications` tiap penerima.
   - `COMMIT`. Response: `{ comment: {id, transaction_id, parent_comment_id, author_user_id,
     author_display_name, body, created_at}, notified: [...user_ids] }`.
   Gagal → rollback + `RollbackAuditService` (3c), throw domain exception.

## Acceptance (HTTP nyata lawan `rdt_dev`; data uji dibersihkan balik ke seed setelahnya)
- [ ] Akses: TAB ke pasangan manapun ✅; PIC dari **inisiator** ATAU **target** pasangan itu ✅; PIC dinas
  lain di luar pasangan → 403.
- [ ] `detail` untuk pasangan yang dicapai via reassign (mis. buka lewat target original TR yang sudah
  redirect ke TQ) → `transactions` termasuk baris yang sekarang `dinas_target` beda tapi chain-nya lewat
  TR; `progress` konsisten dengan set transaksi itu (bukan angka dari kartu 5b).
- [ ] `detail/INVESTIGATION` (case-insensitive, mis. `investigation`/`Investigation`) → baris
  NEEDS_INVESTIGATION dinas itu, tanpa chain logic.
- [ ] Comment thread gabung lintas beberapa transaksi di pasangan yang sama, urut waktu benar,
  `author_display_name` terisi dari directory.
- [ ] POST comment **tanpa** `parent_comment_id` → anchor ke id transaksi terbesar pasangan itu, top-level
  baru (`parent_comment_id IS NULL`).
- [ ] POST comment **dengan** `parent_comment_id` valid → `transaction_id` **inherit dari parent** (bukan
  dari transaksi terbaru), verifikasi di DB.
- [ ] `parent_comment_id` tak ada → 400.
- [ ] @mention dinas di luar pasangan ini → **tidak** ikut notified (privacy-fix, konsisten 3b/3c/4b).
- [ ] Pasangan tanpa transaksi sama sekali + POST tanpa `parent_comment_id` → 400 ("no transactions...").
- [ ] **192 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Setelah selesai
Laporkan: struktur module + helper, hasil tiap acceptance (khususnya akses dua-sisi, progress-langsung-
dari-transactions vs kartu 5b, dan dua mode anchor comment), konfirmasi 192 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 5c ✅ (**dashboard tuntas**).
