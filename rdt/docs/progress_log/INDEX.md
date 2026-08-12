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

## Status akhir per 12 Agu 2026 (akhir sesi 8)

- Branch aktif: `lenovo`, commit terakhir `daf1421`.
- **`rdt/docs/CHECKLIST_LAUNCH.md` sekarang selesai end-to-end** kecuali
  2 item yang memang tanggung jawab tim IT eksternal (IP/VPN whitelisting,
  HTTPS/TLS saat hosting di-setup) — lihat sesi 8 untuk rincian tiap
  section (1.1–1.4, 2.1–2.3, 3, 4).
- Sesi 8 nemu dan langsung memperbaiki **2 regresi self-caught** (bukan
  dilaporkan user) — keduanya akibat guard auth baru dari checklist 1.1
  sendiri belum di-propagate ke semua caller: admin editors
  (`fetch()` tanpa auth) dan `DinasService`/`TransactionService`
  (`HttpClient` tanpa auth header). Keduanya diperbaiki + diverifikasi
  live via browser sebelum sesi ditutup.
- **Database production/dev tetap Supabase** (Postgres remote) sejak sesi
  7 — `rdt/backend/.env`'s `DATABASE_URL` di-update user sendiri (Claude
  di-block akses baca/tulis file itu, by design). Schema `rdt` lengkap 13
  tabel.
- `npm test` hijau di akhir setiap sesi yang menyentuh backend.
- **`/graphify` sudah pernah dijalankan** (sesi 8, 12 Agu) atas seluruh
  repo — graf 1277 node/1957 edge/155 komunitas tersimpan di
  `graphify-out/graph.json` (masih untracked di git, lihat backlog).
- Backlog terbuka:
  - **`DashboardDetailComponent.submitComment()` — gap modal-error belum
    diperbaiki**, ditunda buat didiskusikan user dulu (temuan sesi 8 lewat
    trace graphify).
  - Sidebar hover-expand (REQ-RDT-UI-06 diperluas) — masih suspended,
    nunggu link Dribbble yang bisa diakses.
  - `graphify-out/` masih untracked, belum diputusin gitignore atau commit.
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
