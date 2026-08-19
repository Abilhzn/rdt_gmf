# RDT — Progress Log Index

Rangkuman seluruh sesi Claude Code untuk project RDT (Repost Detail
Transaksi), dari kickoff sampai sesi terakhir sebelum semua session history
di-`/clear`. Dibuat 7 Agustus 2026 atas permintaan project owner, sebagai
catatan permanen di repo — sesi chat aslinya akan dihapus setelah ini.

Tiap file adalah hasil ekstraksi dari transcript `.jsonl` sesi yang
bersangkutan (lokasi asli: `~/.claude/projects/E---tadashi-project-budgeting-gmf/`),
dirangkum oleh subagent terpisah per sesi (kecuali sesi 6, dirangkum
langsung karena itu sesi yang sedang berjalan saat task ini dibuat). Baca
tiap file untuk detail; ringkasan di bawah ini cuma peta jalan.

**Catatan konteks**: sesi 1–4 memakai path pra-restrukturisasi
(`src/backend`, `src/frontend/rdt`) dan sebagian model peran (`SM_TA`/
`GH_TA`/`ADMIN_TAB`) yang sudah disederhanakan tanggal 24 Jul 2026 — jangan
disalahartikan sebagai state saat ini. Struktur/peran yang berlaku sekarang
ada di `rdt/CLAUDE.md`.

## Kronologi

| # | Tanggal | File | Fokus utama |
|---|---------|------|--------------|
| 1 | 20 Jul 2026 | [01_2026-07-20.md](01_2026-07-20.md) | Verifikasi mid-project: test suite, audit fitur tiered SM/GH export-approval (~85% selesai, step SAP masih stub) |
| 2 | 22 Jul 2026 | [02_2026-07-22.md](02_2026-07-22.md) | 4 gap backend (duplicate detection, interim auth, DECLINED reassignment, tiered SM/GH approval), rebuild nav Home/Repost/Confirming, 3 bug produksi dari live testing, 2 putaran integrasi desain Figma |
| 3 | 23 Jul 2026 | [03_2026-07-23.md](03_2026-07-23.md) | Pagination reusable, fitur download file asli (unfiltered by design), `/doctor` cleanup, standing rule baru "backend + ui-demo.html dulu, Angular belakangan", Login/Select Platform, Dashboard-Detailing + comment thread, 4 bug pasca-build (termasuk TJ-TE/TJ-Scrap yang sempat silently dropped) |
| 4 | 26 Jul 2026 | [04_2026-07-26.md](04_2026-07-26.md) | Batch 5 item (parsing TJ, routing Ask TA/TMM, auto-comment repost/confirm, visibilitas dashboard, Corp di antrian TAB) + 3 bug lanjutan (double-counting TJ, auto-navigate, pivot-only file) |
| 5 | 30 Jul 2026 | [05_2026-07-30.md](05_2026-07-30.md) | Pivot besar: Need Approval digeser dari gating per-dinas-inisiasi ke per-pasangan (dinas_inisiasi, dinas_target), subdoc table + state label, Riwayat Repost TAB, 4 gap pasca-review, redesign filter Excel-style (belum sempat commit) |
| 6 | 6 Agu 2026 | [06_2026-08-06.md](06_2026-08-06.md) | Dashboard fidelity + USD currency, fix Notes column + reassign-chain access, **REQ-RDT-SAP-14** (mekanisme deadline: per-pasangan → snapshot bukan live-computed → bulk-set), lalu task rangkuman ini sendiri |
| 7 | 7–11 Agu 2026 | [07_2026-08-11.md](07_2026-08-11.md) | ui-demo.html dihapus total, **Setting Periode** restructure (Override Deadline jadi list-driven + re-evaluate) + 5 item Bagian 2 (termasuk bug SAP-09 auto-archive yang ketemu & diperbaiki), audit repo lokal vs GitHub, rename `develop`→`pc-lab` + branch `lenovo` baru, **migrasi database ke Supabase**, `main` di-fast-forward ke kerjaan terbaru |
| 8 | 12 Agu 2026 | [08_2026-08-12.md](08_2026-08-12.md) | **`CHECKLIST_LAUNCH.md` diselesaikan end-to-end**: security headers/rate-limit/session TTL, validasi teks bebas, audit secrets, backup/restore tooling, monitoring/health/timeout, re-audit integritas data, 404/403 + a11y + WCAG contrast, dokumentasi per-service, loading-state + error-message audit (2 regresi self-caught & diperbaiki: admin editors, lalu DinasService/TransactionService), `/graphify` dijalankan atas seluruh repo + 2 trace eksploratif (nemu 1 gap modal-error belum diperbaiki, ditunda) |
| 9 | 12 Agu 2026 | [09_2026-08-12.md](09_2026-08-12.md) | **SESI DITUTUP.** Plugin `ponytail` diinstall, **REQ-RDT-SAP-15** (breakdown per pasangan di Summary Progress All Dinas, full reuse `buildChainAwareProgress`+`#pairCard`), debug "icon unclickable" (root cause: proses backend lama belum di-restart, bukan bug kode), fix gap modal-error `DashboardDetailComponent.submitComment()` yang ditunda sesi 8, cleanup backlog (`_tmp_check.md` dihapus, `graphify-out/` di-gitignore) — commit `2c19d31`/`4ca58be`/`ca7416c`/`a163f2f`, semua sudah di-push ke `origin/lenovo` |
| 10 | 12 Agu 2026 | [10_2026-08-12.md](10_2026-08-12.md) | `ponytail-audit` (tidak ada yang perlu dipangkas) + review efisiensi N+1/`trackBy` (sudah dibatch dengan benar, tidak ada perubahan), data-engineering pass: index baru `idx_txn_inisiasi_status` (`019_txn_inisiasi_status_index.sql`, belum di-commit), restart backend+dev-shell (sukses, health OK) tapi verifikasi UI lewat Chrome MCP terblokir (ekstensi belum konek) |
| 11 | 14 Agu 2026 | [11_2026-08-14.md](11_2026-08-14.md) | Verifikasi ulang SAP-21/22 (ketemu: stale backend process, bukan bug — root cause & fix didokumentasikan), **REQ-RDT-SAP-23** (hapus preview tabel di "Confirm Reposted", sudah benar dari sebelumnya) + **REQ-RDT-UI-11 revisi** (Catatan Reviewer 80px→48px), commit gabungan `c9d6cbc`, data sintetis fitur Share-Cost (`tools/seedShareCostSynthetic.js`, 4 transaksi PENDING `dinas_target='TAB'`) |
| 12 | 17–18 Agu 2026 | [12_2026-08-18.md](12_2026-08-18.md) | **SRS 3.13** (periode auto-derive, deadline reminder banner, overdue dibalik jadi sticky + konflik Override Deadline ditemukan&dihapus, filter Riwayat Repost disederhanakan), audit+eksekusi UI "kaku" (hover/transisi/busy-spinner/skeleton, native CSS), koreksi navigasi Setting Periode (2 sub-halaman → 1 flat page), audit+eksekusi tipografi (SCSS partial pertama di repo, type scale + treatment numerik), audit+eksekusi copy (generic "Error:"/English leftover → kontekstual Indonesia) — 5 commit, semua di-push |
| 13 | 19 Agu 2026 | [13_2026-08-19.md](13_2026-08-19.md) | **"Jalur Repost"** — audit "AI banget"/generic dashboard, 3 arah diusulkan (chain reassign dipilih jadi tanda tangan visual), validasi via mockup Artifact HTML statis (token produksi verbatim) sebelum sentuh kode, koreksi warna (biru $accent, bukan amber), implementasi ke `#pairCard` (donut ternyata sudah mati kode sejak 5 Agu — yang diganti badge-chain, segment-bar tetap ada), expand hop-detail dipindah dari sideways ke inline — commit `cd2fa7e`, di-push |

## Garis besar evolusi arsitektur

- **20–23 Jul**: masih struktur lama (`src/backend`), fondasi auth/parser/
  ledger dibangun dan diverifikasi terhadap file Excel nyata.
- **24 Jul** (di luar 6 sesi ini, lihat commit history): restrukturisasi
  besar — `auth`/`data_user` ditarik keluar jadi service bersama,
  role SM_TA/GH_TA dihapus (disederhanakan jadi PIC/TAB saja), path pindah
  ke `rdt/backend`/`rdt/frontend`.
- **26–30 Jul**: fitur bisnis inti matang — model approval per-pasangan
  (bukan per-dinas), subdoc, comment/notification, filter reusable.
- **1–6 Agu**: fokus bergeser ke UI/UX fidelity (Figma sync, density,
  currency, symmetry, sticky columns) dan REQ-RDT-SAP-14 (deadline +
  snapshot periode_efektif) — fitur bisnis besar terakhir sebelum sesi ini
  ditutup.

## Status akhir per 19 Agu 2026 (akhir sesi 13)

- Branch aktif: `lenovo`, commit terakhir di-push `cd2fa7e`. Sesi 13
  mengerjakan **"Jalur Repost"** — chain reassign (TJ→TE→TL) dipromosikan
  jadi visual utama tiap `#pairCard` (ganti badge-chain kecil ▶), warna
  biru `$accent` untuk hop aktif, hijau `$green` untuk hop settled — lihat
  [13_2026-08-19.md](13_2026-08-19.md) untuk rincian.
- **Temuan penting**: `.dinas-circle` (donut ring) di `home.component.html`'s
  `#pairCard` **sudah mati kode sejak 5 Agu** — SEMUA 3 caller pakai
  `useBar: true` (segment-bar), donut cuma hidup di
  `dashboard-detail.component.html`'s header sendiri (halaman detail 1
  pasangan, layout beda, SENGAJA di luar scope Jalur Repost). Jangan
  asumsikan ulang "kartu Dashboard pakai donut" tanpa cek `useBar` di
  caller-nya dulu.
- Segment-bar (Confirmed/Open/Declined breakdown) TETAP ada di bawah
  strip Jalur Repost — bukan diganti, itu info komposisi yang beda dari
  jalur/chain.
- Klik expand hop-detail (`rdt-chain-hop-detail`) sekarang INLINE di bawah
  strip, bukan lagi sideways lewat divider+panel terpisah (REQ-RDT-NAV-03,
  5 Agu, sekarang superseded) — `.pair-card` balik jadi block biasa, bukan
  flex-row.
- Sesi 12 (di bawah, masih akurat untuk kondisi 18 Agu): **SRS 3.13**
  lengkap (periode auto-derive, deadline reminder, overdue sticky, filter
  Riwayat Repost) + audit&eksekusi UI-kaku/navigasi-Setting-Periode/
  tipografi/copy — 5 commit (`683d43c`..`09bd490`).
- **Konflik "Override Deadline" vs sticky-overdue** ditemukan 2x (sesi 12,
  Bagian 0 dan Bagian 2) — endpoint `POST /period-deadlines/
  override-reevaluate` dan tombolnya di UI sudah dihapus total per
  keputusan project owner, jangan di-restore tanpa keputusan baru.
- `shared/_typography.scss` — SCSS partial PERTAMA di repo ini (sesi 12).
  Konvensi lama "tiap komponen duplikat `$variable` sendiri, gak ada
  `@import`/`@use`" **tidak lagi berlaku mutlak** — deliberate exception
  buat type-scale/numeric-treatment tokens, `@use`'d di 8 komponen.
- Bug extension Chrome (browser automation) berulang kali muncul sesi 12
  DAN 13 ("Frame with ID 0 is showing error page" khusus `localhost:4200`,
  atau stale compile-error overlay dari `ng serve` watcher) — belum
  diketahui akar masalahnya, biasanya pulih sendiri setelah fresh
  tab/reload. Dicatat lagi kalau kejadian lagi.

## Status akhir per 12 Agu 2026 (akhir sesi 10)

- Branch aktif: `lenovo`, commit terakhir di-push `a163f2f`
  (`2c19d31`/`4ca58be`/`ca7416c`/`a163f2f`, semua dari sesi ≤9). Sesi 10
  menambahkan `sql/migrations/019_txn_inisiasi_status_index.sql`
  (index `idx_txn_inisiasi_status` untuk sisi inisiasi pasangan
  dinas — lihat sesi 10) yang **masih untracked, belum di-commit**.
- Backend + dev-shell butuh restart manual di awal sesi berikutnya —
  keduanya sempat mati di tengah sesi 10 (proses Claude Code restart),
  belum dinyalakan ulang saat sesi ditutup.
- Ekstensi Chrome (`claude-in-chrome`) belum konek/login — verifikasi UI-
  driven (klik langsung, bukan cuma curl smoke test) masih terblokir
  sampai user connect/login di claude.ai/chrome.
- **`rdt/docs/CHECKLIST_LAUNCH.md` selesai end-to-end** kecuali 2 item
  tanggung jawab tim IT eksternal (IP/VPN whitelisting, HTTPS/TLS saat
  hosting di-setup) — lihat sesi 8 untuk rincian tiap section.
- **REQ-RDT-SAP-15 selesai** (sesi 9): breakdown per pasangan di tabel
  Summary Progress All Dinas — endpoint baru TAB-only + ikon expand-row
  di frontend, full reuse `buildChainAwareProgress` dan template
  `#pairCard` yang sudah ada, gak ada halaman/komponen baru.
- **`DashboardDetailComponent.submitComment()` gap modal-error (temuan
  sesi 8) sudah diperbaiki sesi 9** — disamakan ke pola
  `ModalService.alert()` yang dipakai 20+ pemanggil mutating lain di app.
- Plugin Claude Code **`ponytail@ponytail`** terinstall (sesi 9,
  scope user) — minimalism/reuse-first decision ladder,
  `/ponytail-review` & `/ponytail-audit` tersedia.
- **Catatan operasional (sesi 9)**: `rdt/backend` (`npm start`) gak punya
  watch/hot-reload — proses lama yang masih jalan pas source di-edit
  WAJIB di-restart manual sebelum verifikasi live, kalau tidak endpoint
  baru kelihatan "gak berfungsi" padahal kodenya benar (lihat sesi 9
  Bagian 3 untuk kronologi debug-nya).
- **Database production/dev tetap Supabase** (Postgres remote) sejak sesi
  7 — `rdt/backend/.env`'s `DATABASE_URL` di-update user sendiri (Claude
  di-block akses baca/tulis file itu, by design). Schema `rdt` lengkap 13
  tabel.
- `npm test` hijau di akhir setiap sesi yang menyentuh backend.
- **`/graphify` sudah pernah dijalankan** (sesi 8, 12 Agu) atas seluruh
  repo — graf 1277 node/1957 edge/155 komunitas tersimpan di
  `graphify-out/graph.json` (masih untracked di git, lihat backlog).
- ~~`graphify-out/` untracked, belum diputusin gitignore~~ dan
  ~~`rdt/docs/_tmp_check.md` untracked~~ — **dibereskan sesi 9**:
  `_tmp_check.md` dihapus (placeholder kosong), `graphify-out/` tetap ada
  di disk tapi di-gitignore (regenerable via `/graphify`, sayang buang
  hasil compute-nya).
- Backlog terbuka:
  - Sidebar hover-expand (REQ-RDT-UI-06 diperluas) — masih suspended,
    nunggu link Dribbble yang bisa diakses.
  - Auth/data_user masih provisional/synthetic (TODO(IT-AUTH)) — nunggu
    tabel karyawan resmi tim IT GMF.

## Catatan proses (untuk yang baca ini nanti)

Rangkuman ini dibuat dengan cara: (1) ekstrak transcript `.jsonl` tiap sesi
jadi teks ringkas (buang payload tool besar, screenshot, dsb — >95%
reduksi ukuran), (2) delegasikan pembacaan+peringkasan tiap ekstrak ke
subagent terpisah dengan context kosong, supaya sesi yang menulis file ini
sendiri tidak perlu menyerap seluruh riwayat mentah ke context-nya. Detail
lengkap tiap keputusan teknis, kode, dan pesan asli user ada di
transcript `.jsonl` masing-masing (path lama, sebelum di-`/clear`) — file
di direktori ini adalah rangkuman, bukan pengganti lengkap.
