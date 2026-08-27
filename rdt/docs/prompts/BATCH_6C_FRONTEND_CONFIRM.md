# PROMPT — Batch 6c: Frontend — Confirm (confirm/: confirmation+reassignment+investigation+comment)

> Tempel ke agent eksekutor. Jalankan SETELAH 6a (dan idealnya 6b, tapi tidak wajib — modul beda).
> Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 6). Backend & `auth/frontend/` **JANGAN diubah**.
> Ini komponen PALING BESAR di Batch 6 — 6 service digabung jadi satu komponen monolitik sekarang.

## Konteks

Sumber: `rdt/frontend/rdt/confirm/confirm.component.ts` (+html/scss/module) — komponen ini gabungin
4 konsep backend berbeda dalam satu file: **queue confirm/decline (Batch 3b)**, **resolve DECLINED
(Batch 3c reassignment: BORNE/REASSIGN)**, **investigation view (Batch 3c)**, dan **comment thread
(Batch 5c, reuse service)**. Plus import `TransactionService`/`ContractField` yang **stale** (sama
masalah seperti 6b — format 53-kolom lama).

**Kontrak backend-nest yang sudah pasti (baca ulang service backend-nest terkait sebelum
implementasi untuk detail field persis, tapi endpoint/semantik di bawah ini SUDAH BENAR):**

- **Queue** — `GET repost/confirmation/:dinas` (breadcrumb chain untuk baris reassign). `POST
  repost/confirmation/:dinas/submit` — body `{decisions:[{id,claim:'YA'|'TIDAK',redirect_to?}],
  description?}`. `claim:'YA'`→CONFIRM. `claim:'TIDAK'` + `redirect_to`→REJECT_REDIRECT (langsung
  reassign, TANPA lewat status DECLINED). `claim:'TIDAK'` tanpa `redirect_to`→DECLINE biasa.
- **Reassignment (baris DECLINED)** — `GET repost/reassignment/:dinas`. `POST
  repost/reassignment/:id/resolve` body `{action:'BORNE'|'REASSIGN', new_dinas_target?, note?}`.
  `POST repost/reassignment/batch-resolve` body `{items:[...], note?}` (atomik). **REASSIGN_CAP=3**
  — UI sebaiknya nonaktifkan opsi REASSIGN kalau `reassign_count>=3` (cek field di response GET,
  tampilkan pesan, jangan cuma andalkan 400 dari server).
- **Investigation** — `GET repost/investigation/`, `POST repost/investigation/:transactionId/assign`
  body `{dinas_target, description?}`, `POST repost/investigation/assign-all` body
  `{items:[{transaction_id,dinas_target}], description?}`. **TAB-only** — sembunyikan UI ini sama
  sekali untuk non-TAB (backend sudah 403, tapi jangan render tombol yang pasti gagal).
- **Comment/reply** — dashboard-detail service (5c) `GET/POST
  dashboard/detail/:initiatorDinas/:targetDinas/comments`. Dipakai buat thread di panel ini.
- **Dinas picker (redirect_to/new_dinas_target)** — WAJIB pakai `GET /dinas` (aktif-saja, 23 baris)
  dari `dinas.service.ts` — **JANGAN** biarkan user pilih dinas nonaktif/`TAB` sebagai target
  reassign (aturan `is_active`, tracker §6). Ini bug lama yang mungkin sudah benar — verifikasi,
  jangan asumsi sudah benar.
- **Status**: sama seperti 6b — `PENDING|EXCLUDED|NEEDS_REVIEW|NEEDS_INVESTIGATION`, bukan
  `INVALID`. Field per-baris sama seperti 6b (Format CBO + turunan).

## Tugas

1. **Pecah jadi `features/confirmation/`** dengan sub-struktur per konsep (jangan satu file
   raksasa lagi):
   - `pages/confirm-page.component.ts` (SMART, orkestrasi + routing `?from=` query param seperti sekarang).
   - `components/pending-queue.component` (DUMB — tabel + checkbox confirm/decline + redirect picker).
   - `components/declined-resolution.component` (DUMB — BORNE/REASSIGN form).
   - `components/investigation-panel.component` (DUMB, dirender kondisional hanya utk TAB).
   - `components/comment-thread.component` (DUMB — bisa REUSE dari `features/dashboard/` kalau 6d
     sudah membuatnya sebagai component reusable; kalau belum, buat versi lokal dan catat sebagai
     kandidat konsolidasi nanti — **jangan blocking nunggu 6d**).
   - `services/confirmation.service.ts`, `reassignment.service.ts`, `investigation.service.ts`
     (dipindah dari `services/` lama, endpoint & response disesuaikan kontrak di atas).
2. **Baca `confirm.component.ts` ASLI dulu secara utuh** sebelum memecah — banyak detail UX (single
   checkbox = confirm, select-all, per-baris redirect dropdown, dst.) yang harus dipertahankan,
   bukan ditulis ulang dari nol.
3. Update `previewColumns`/`CURATED_CONTRACT_KEYS` sama seperti 6b (Format CBO, bukan 53-kolom).
4. Reuse `DinasService.listActive()` untuk semua dropdown target — pastikan konsisten dengan 6b
   kalau `DinasService` sendiri perlu update kontrak.

## Acceptance
- [ ] Confirm/decline queue jalan, breadcrumb chain tampil untuk baris reassign.
- [ ] REJECT_REDIRECT (decline + pilih target) jalan dalam satu submit, tanpa mampir status DECLINED dulu.
- [ ] Resolve DECLINED — BORNE (nol ledger, tak ada UI yang menyiratkan ledger) & REASSIGN (dinas
  aktif saja di dropdown, cap 3 dihormati di UI).
- [ ] Investigation panel HANYA muncul untuk TAB.
- [ ] Comment thread tampil & bisa reply.
- [ ] Tidak ada referensi `CONTRACT_FIELDS`/`INVALID` status tersisa.
- [ ] `ng build`/lint bersih. Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: struktur `features/confirmation/` final, keputusan soal comment-thread component (reuse
atau lokal), field response yang dikonfirmasi dari source. Update tracker §0 → Batch 6c ✅.
