# PROMPT — Batch 6d: Frontend — Dashboard + Dashboard-detail

> Tempel ke agent eksekutor. Jalankan SETELAH 6a. Independen dari 6b/6c/6e/6f (modul terpisah),
> boleh paralel. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 6). Backend & `auth/frontend/`
> **JANGAN diubah**.

## Konteks

Sumber: `rdt/frontend/rdt/home/` (`HomeComponent` + `home.module.ts`) + `rdt/frontend/rdt/
dashboard-detail/` (`DashboardDetailComponent` — **nested route DI DALAM `home.module.ts`**,
`path: 'detail/:initiator/:target'`, BUKAN module Angular terpisah — pertahankan pola nested-route
ini, jangan pecah jadi top-level route beda karena ada alasan UX: sidebar tetap aktif di halaman
drill-down, lihat komentar `home.module.ts`). Backend: `modules/dashboard/` (Batch 5b baca-saja +
5c detail/comment).

**Kontrak backend-nest (sudah pasti dari Batch 5b/5c):**
- `GET dashboard/summary` → `{own_dinas, as_initiator, need_to_confirm, is_global_view}`. Shape
  `as_initiator`/`need_to_confirm` per-entry: `{dinas, target_dinas?, total, resolved, pending,
  percent, chain?, overdue, state_label, reply_count, declined_pending_action}` (`target_dinas`
  hanya ada saat `groupBy:'pair'`, yaitu view TAB — cek exact shape di `dashboard.service.ts`).
- `GET dashboard/need-to-confirm-count` → `{count}` (badge sidebar).
- `GET dashboard/kpis` → **shape beda TOTAL per role** — PIC: `{is_global_view:false,
  total_transaksi, total_nilai, pasangan_count, open_count, resolved_count}`; TAB:
  `{is_global_view:true, dinas_aktif, total_transaksi, butuh_investigasi, waiting_to_repost,
  reposted}`. UI harus render dua layout kartu KPI berbeda, bukan satu template dgn field opsional.
- `GET dashboard/per-dinas-rollup` (TAB-only) → array per dinas + `status_pill:{kind,label}` (4
  jenis: `investigation|pending|reposted|waiting-repost` — styling beda per kind).
- `GET dashboard/summary/:dinasInisiasi/breakdown` (TAB-only) → drill-down klik dari rollup.
- `GET dashboard/detail/:initiatorDinas/:targetDinas` → `{initiator_dinas, target_dinas, progress,
  transactions, comments}`. Sentinel `targetDinas='investigation'` (case-insensitive, backend tidak
  peduli case) → tampilan baris NEEDS_INVESTIGATION tanpa breadcrumb chain.
- `GET/POST dashboard/detail/:i/:t/comments` — thread. POST body `{body, parent_comment_id?}`.

## Tugas

1. **`features/dashboard/`**: `pages/dashboard-page.component.ts` (SMART — `HomeComponent` lama,
   fetch `summary`+`kpis`+`need-to-confirm-count`, role-aware render), `pages/dashboard-detail-
   page.component.ts` (SMART — `DashboardDetailComponent` lama, tetap NESTED ROUTE di
   `dashboard.module.ts` persis pola lama), `components/` (DUMB — kartu progress per-pasangan,
   kartu KPI PIC vs TAB terpisah, per-dinas-rollup table dgn status pill, comment-thread — kandidat
   yang bisa DIPAKAI LAGI di 6c kalau 6c belum bikin sendiri; kalau 6c sudah jalan duluan dan bikin
   versi lokal, KONSOLIDASI ke sini kalau practical, tapi jangan blocking).
2. **Baca `home.component.ts` + `dashboard-detail.component.ts` ASLI dulu** — banyak logic render
   (breadcrumb chain display, overdue badge, state_label styling) yang harus dipertahankan.
3. `services/dashboard.service.ts` (gabung `dashboard.service.ts` + `dashboard-detail.service.ts`
   lama, atau tetap dua file kalau lebih rapi — keputusan di tangan eksekutor, yang penting tak
   duplikasi HTTP-call logic).
4. Role-aware rendering: `per-dinas-rollup`/`breakdown` hanya untuk TAB (`*ngIf` role, backend juga
   403 tapi jangan render UI yang pasti gagal).

## Acceptance
- [ ] Dashboard PIC: kartu progress `as_initiator` (view personal), KPI shape PIC.
- [ ] Dashboard TAB: kartu lintas-dinas (`groupBy:'pair'`), KPI shape TAB, rollup+breakdown terlihat.
- [ ] Klik kartu → drill-down ke detail (nested route, sidebar tetap aktif "Dashboard").
- [ ] Detail investigation (`target=investigation`) menampilkan baris tanpa chain.
- [ ] Comment thread di detail bisa dibaca & reply.
- [ ] Overdue badge & state_label tampil sesuai data backend (bukan dihitung ulang di frontend).
- [ ] `ng build`/lint bersih. Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: struktur `features/dashboard/` final, field response yang dikonfirmasi dari source,
keputusan konsolidasi comment-thread component (kalau relevan dengan 6c). Update tracker §0 →
Batch 6d ✅.
