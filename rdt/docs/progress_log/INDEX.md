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

## Status akhir per 6 Agu 2026 (akhir sesi 6)

- Branch aktif: `rdt/ui-batch-5-agu-symmetry-sticky-cols`, commit terakhir
  `9659a0d`, **belum di-push, belum di-merge/PR ke `main`**.
- `npm test` hijau di akhir setiap sesi yang menyentuh backend.
- Backlog terbuka (lihat detail di `06_2026-08-06.md`):
  - ~~`ui-demo.html` tidak sinkron dengan redesign dashboard Angular.~~
    **Resolved 7 Agu**: `ui-demo.html` dihapus, bukan disinkron — Angular
    satu-satunya frontend sekarang. Lihat sesi 7 Agu.
  - Sidebar hover-expand (REQ-RDT-UI-06 diperluas) — suspended, nunggu link
    Dribbble yang bisa diakses. **7 Agu**: ditunda lebih lanjut sampai
    Minggu malam atas permintaan user.
  - ~~Chat-bubble icon kecil yang hilang di pair-card (kosmetik minor).~~
    **Fixed 7 Agu** — bukan kosmetik, dibutuhkan untuk nunjukin jumlah
    komen.
  - Branch belum di-merge/PR. **7 Agu**: dipush ke remote, TETAP TIDAK
    di-merge ke `main` atas instruksi user.
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
