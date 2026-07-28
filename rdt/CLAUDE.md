# CLAUDE.md — Repost Detail Transaksi (RDT)

Project ini sebelumnya dikerjakan pakai opencode (GPT-5 Mini/5.2). Sekarang
pindah ke Claude Code. Dokumen ini rangkuman lengkap brief bisnis + status
teknis terkini supaya kamu tidak perlu re-discover dari nol.

**Restrukturisasi 24 Jul 2026**: project ini sekarang salah satu dari
beberapa app di bawah root repo yang sama (lihat `../CLAUDE.md`). Auth &
data user sudah dipindah KELUAR dari sini ke `../auth/` dan `../data_user/`
— `rdt/backend` memanggilnya sebagai service terpisah, bukan lagi
`require()` lokal. Semua path di dokumen ini sudah disesuaikan ke lokasi
baru (`rdt/backend/...`, `rdt/frontend/...`), bukan lagi `src/backend/...`.

**ATURAN PERTAMA — baca sebelum menyentuh git sama sekali:**
`.gitignore` (di root repo, bukan di sini) meng-exclude `.env` dan
`confidential.txt`. SEBELUM menjalankan `git add`/commit apapun yang
menyentuh file baru, verifikasi ulang `.gitignore` benar-benar meng-exclude
keduanya. Jangan pernah membaca isi `confidential.txt` kecuali diminta
eksplisit oleh user.

## 1. Apa ini

Modul **RDT (Repost Detail Transaksi)** — bagian dari platform web internal
Divisi TAB, GMF AeroAsia. Menggantikan rekonsiliasi anggaran manual
berbasis email/Excel antar 21 dinas dengan sistem digital yang:
1. Mengekstrak file Excel laporan transaksi bulanan tiap dinas.
2. Meminta dinas target **mengonfirmasi kepemilikan** tiap tagihan (bukan
   approve/reject biasa — ini klaim "ini punya kami / bukan").
3. Menjaga integritas anggaran lewat double-entry ledger yang atomic.
4. Meng-gate ekspor ke SAP sampai semua data final & disetujui berjenjang.

Dokumen requirement lengkap ADA DI SINI, WAJIB DIBACA sebelum kerja apapun:
- `docs/SRS.md` — requirement bisnis, functional requirements (REQ-RDT-*),
  test scenario, dan **section 3.1.1 berisi analisis mendalam struktur file
  Excel nyata dari dinas** — jangan asumsikan struktur file tanpa baca ini.
- `docs/IRS.md` — konteks infrastruktur (platform existing, bukan app baru).
- `docs/Test_Case_RDT_Repost_Budgeting.xlsx` — 25 test case format BINAR,
  6 sheet per fitur.
- `contoh_input/06. DT TB - Jun 2026.xlsx` — file Excel nyata dari dinas TB,
  dipakai sebagai regression test (angka pivot-nya jadi acceptance criteria).

## 2. Konteks arsitektur (jangan diasumsikan ulang)

- **RDT BUKAN aplikasi standalone.** ini module/route baru yang akan
  ditempel ke aplikasi Angular + Node.js internal GMF yang sudah ada
  (portal disebut "OCX"). Stack: **Angular (FE) + Node.js (BE) +
  PostgreSQL (DB)**. Bukan Streamlit — itu asumsi versi paling awal yang
  sudah dibuang.
- **Auth & data user BUKAN bagian dari rdt lagi** (restrukturisasi 24 Jul)
  — lihat `../auth/` dan `../data_user/`, dan `../CLAUDE.md` untuk kenapa.
  `rdt/backend` memanggil `auth` service untuk verifikasi session, bukan
  `require()` file lokal.
- **Ada DUA frontend RDT di repo ini, sengaja, jangan bingung:**
  - `backend/src/frontend/rdt/ui-demo.html` — Vanilla HTML/JS satu file,
    di-serve backend di `localhost:4000`. Ground truth visual untuk resync
    Angular (lihat section 8) — TIDAK lagi dipakai untuk uji coba
    interaktif sehari-hari (itu sekarang langsung di Angular dev-shell,
    `frontend/dev-shell/`, `ng serve` port 4200), tapi tetap WAJIB
    disinkronkan setiap kali Angular berubah.
  - `frontend/rdt/` — source Angular (component/service/module/guard)
    untuk ditempel ke repo Angular tim IT nanti. Auth-related pieces
    (Login/SelectPlatform/current-user.service.ts) sudah pindah ke
    `../auth/frontend/` — bukan di sini lagi.
  - Baca `README.md` (di folder ini) untuk detail aturan sinkronisasi ini.
- Database: schema terpisah `rdt` di PostgreSQL (bukan bikin instance
  sendiri) — lihat `backend/sql/schema.sql`. Kolom `*_user_id` di semua
  tabel TIDAK punya FK ke tabel user — itu disengaja, karena tabel
  karyawan/user sudah dikelola tim IT dan kita belum tahu nama tabelnya
  (lihat Open Questions di IRS.md). **Jangan bikin tabel user baru.**

## 3. Non-negotiable business rules (jangan disederhanakan tanpa tanya user)

- **Atomic ledger**: klaim "Ya" (CONFIRMED) harus menulis status transaksi
  + sepasang ledger entry (DEBIT dinas target, CREDIT dinas inisiasi) dalam
  SATU transaksi database (`BEGIN...COMMIT`), full `ROLLBACK` kalau gagal.
  Row-level lock (`SELECT...FOR UPDATE`) wajib dipakai untuk cegah dua
  proses submit bersamaan pada baris yang sama. (SRS `REQ-RDT-LEDGER-03/04`)
- **Semantik konfirmasi = klaim kepemilikan, bukan approve/reject generik.**
  "Ya" = transaksi ini milik dinas kami → CONFIRMED. "Tidak" = bukan milik
  kami → DECLINED. Status DECLINED **tidak berhenti di situ** — dinas
  pengaju nanti pilih menanggung sendiri (BORNE_BY_INITIATOR) atau
  mengajukan ulang ke dinas lain (reassign, balik ke PENDING).
- **Audit trail wajib** untuk setiap CONFIRM/DECLINE/EXPORT/ROLLBACK:
  siapa, transaksi apa, status sebelum/sesudah, timestamp, IP.
- **Otorisasi harus reuse tabel karyawan existing milik tim IT** — bukan
  bikin sistem user baru. Ini masih open question (nama tabel belum tau).
  `../auth/` dan `../data_user/` tetap provisional/synthetic sampai ini
  terjawab — lihat TODO(IT-AUTH) di kodenya.
- **Nominal negatif itu SAH** kalau baris reversal/accrual — jangan pernah
  reject nominal negatif secara buta. Validasi harus deteksi konteks
  reversal, bukan cek `nominal >= 0`.
- **Dinas-routing derivation**: kolom utama adalah `Remarks` (prefix
  sebelum "-", di-normalize lewat `mapping.seed.json`). Kalau `Remarks`
  kosong, fallback ke kolom `Review <dinas>` (mis. TJ's `Review TJ`) kalau
  ada — cek mapping.seed.json dulu, baru fallback ke "ambil 2 huruf
  pertama nilai itu sebagai kode dinas" (aturan project owner, 24 Jul).
  Jangan generalize fallback ini ke kolom `Remarks` sendiri — itu tetap
  cuma mapping.seed.json eksplisit, biar behavior TB yang sudah
  ter-verifikasi gak berubah.
- Kalau ada task yang menyentuh salah satu poin di atas, treat sebagai
  perubahan sensitif: jelaskan rencana ke user dulu sebelum eksekusi
  besar, terutama kalau menyentuh logic ledger atau skema DB.

## 4. Status implementasi saat ini (per 24 Jul 2026, verifikasi ulang saat mulai)

**Sudah jalan, verified (backend + Angular dev-shell + `ui-demo.html`):**
- Parser lengkap: deteksi sheet pivot/summary (REQ-RDT-EXT-07, sheet
  bernama mengandung "summary" ATAU cell A3="Sum of In PCLC"), format
  kedua (Cost.Ctr1/Cost.Element/Amount/Cost.Ctr2/Qty/UoM/Text, REQ-RDT-EXT-01),
  fallback dinas-routing lewat kolom `Review <dinas>` saat `Remarks`
  kosong, deteksi duplikasi cross-upload (REQ-RDT-EXT-03), penyimpanan
  file asli (REQ-RDT-EXT-08).
- Schema v2 lengkap, diterapkan ke Postgres lokal (`rdt_dev`).
- Otorisasi (TODO(IT-AUTH), sekarang di `../auth/`): Corp cuma role `TAB`
  (REQ-RDT-AUTH-04; di-rename dari `ADMIN_TAB` 24 Jul). Role SM_TA/GH_TA
  dihapus total 24 Jul (koreksi project owner) — cuma tersisa `PIC` dan
  `TAB`; Repost & Confirmation sekarang tanpa role-gate sama sekali
  (REQ-RDT-AUTH-05 superseded), TAB sendiri yang meng-approve semua
  pengajuan (termasuk Corp) dan lihat Dashboard-Detailing semua dinas.
- Login + Select Platform (REQ-RDT-NAV-08) — username/password sungguhan
  (synthetic/demo), session token, sekarang tinggal di `../auth/frontend/`.
- Sidebar + routing (Dashboard/Repost/Confirmation/Need Approval) —
  REQ-RDT-NAV-01/06, termasuk di Angular (bukan cuma ui-demo.html).
- Dashboard 2-panel (REQ-RDT-NAV-02) — progress ring 3-warna per pasangan
  dinas + panel "Need to Confirm", termasuk global view untuk role TAB.
- Dashboard-Detailing (REQ-RDT-NAV-03) + comment thread berjenjang +
  @mention dengan keyboard nav (REQ-RDT-COMMENT-01/02/03) — di Angular juga.
- Repost 2-kolom + Confirm/Cancel (REQ-RDT-NAV-04), @mention di keterangan.
- Confirmation (REQ-RDT-NAV-05) — checkbox per baris, redirect langsung per
  baris (REQ-RDT-LEDGER-07 jalur a), download file asli (REQ-RDT-LEDGER-09),
  pagination reusable (REQ-RDT-NAV-07), di Angular juga.
- Need Approval — TAB-only, single-tier approval (DRAFT → WAITING_APPROVAL
  → APPROVED → EXPORTED, disederhanakan dari tiered SM/GH 24 Jul), jelas
  ditandai stub buat generate file SAP asli.
- Reassignment untuk DECLINED (REQ-RDT-LEDGER-07 jalur b): Tanggung
  Sendiri / Ajukan Ulang, termasuk batch "Confirm All".
- **25 Jul koreksi/tambahan project owner:**
  - Parser routing: `mapping.seed.json` nambah `"Ask TA": "TAB"` (variant
    literal dari kolom `Review <dinas>` yang belum ke-cover sebelumnya —
    `"TA"` polos sudah ke-mapping ke `TAB`, tapi `"Ask TA"` belum).
    `TMM`/`ZGMFTMM` -> `TM` (sub-dinas, aturan "2 huruf pertama") sudah
    jalan dari sesi sebelumnya, tidak berubah.
  - Dashboard "Need to Confirm" TIDAK LAGI langsung hilang begitu semua
    baris PENDING dari 1 dinas pengaju beres — tetap tampil sampai batch
    export yang menampung baris itu di-APPROVE oleh TAB
    (`dashboard.js` `/summary`, join ke `rdt.export_batches`).
  - Dashboard "Need to Confirm" milik TAB sekarang include antrian
    `Corp` juga (dulu cuma `dinas_target='TAB'`).
  - Repost: `description` (kolom Keterangan) sekarang auto-post jadi
    comment top-level di Dashboard-Detailing tiap pasangan
    (initiator, target) yang disentuh upload itu (`POST /api/persist`).
  - Confirmation: `POST /api/confirmation/:dinas/submit` sekarang terima
    `description` opsional — di-post sebagai REPLY di bawah comment
    repost initiator-nya (fallback ke top-level comment baru kalau belum
    ada comment repost untuk pasangan itu). Field ini ada di Angular
    (`confirm.component`) dan `ui-demo.html` (`#mp-description`).

**BELUM ada / masih terbuka:**
- Auth/data_user sebagai service HTTP terpisah beneran (Phase 2 dari
  restrukturisasi 24 Jul) — saat ini masih transisi, cek `../CLAUDE.md`
  untuk status Phase 1 vs Phase 2.
- Redesign Dashboard (diminta user 24 Jul, belum mulai).

## 5. Cara jalanin & verifikasi

```bash
cd rdt/backend
npm install
npm test              # HARUS hijau — parser vs angka pivot terverifikasi
npm start             # buka http://localhost:4000 (perlu DATABASE_URL utk fitur DB)
```

```bash
cd rdt/frontend/dev-shell
npm install
ng serve               # buka http://localhost:4200/rdt — proxy ke backend port 4000
```

`DATABASE_URL` contoh: `postgresql://postgres:PASSWORD@localhost:5432/rdt_dev`
(Postgres lokal user, database `rdt_dev`, schema `rdt` sudah diterapkan) —
taruh di `rdt/backend/.env` (gitignored), otomatis ke-load lewat `dotenv`.

## 6. Kalau mau lanjut kerja, urutan yang disarankan

1. `npm test` dulu, pastikan hijau, sebelum ubah apapun.
2. Baca gap di section 4 di atas, konfirmasi ke user prioritas mana dulu.
3. Untuk perubahan skema/logic ledger/auth: rencana dulu, baru eksekusi —
   jangan langsung nulis banyak file sekaligus tanpa konfirmasi user.

## 7. Model strategy (equivalent dari setup opencode sebelumnya)

Setup `opencode.json` (build=GPT-5 Mini murah, plan/senior-advisor=GPT-5.2)
TIDAK terbaca oleh Claude Code — beda tool, beda config. Padanannya di
Claude Code:

- **Sesi utama** — jalankan dengan `claude --model sonnet` (default yang
  disarankan: cukup kuat buat implementasi harian, jauh lebih murah dari
  Opus). Ini pengganti peran "build", dan juga persis pola "Executor" (model
  murah jalan tiap giliran) yang di-benchmark Anthropic khusus untuk coding
  — 92% skor dengan 63% biaya dibanding full model premium.
- **`senior-advisor` subagent** (`.claude/agents/senior-advisor.md`, sudah
  dibuat, read-only, jalan di **Fable 5**) — pengganti peran "senior-advisor"
  di opencode, sekaligus peran "Advisor" (dipanggil on-demand, bukan tiap
  giliran) persis seperti benchmark aslinya. Ter-invoke otomatis (atau
  panggil eksplisit `@senior-advisor`) saat perubahan menyentuh
  ledger/schema/auth/hal yang di-flag non-negotiable di section 3, atau saat
  sebuah fix sudah gagal 2x.
- **`worker` subagent** (`.claude/agents/worker.md`) — buat kerjaan
  remeh yang gak butuh judgment (cari lokasi kode, cek konvensi existing,
  rename/format sederhana): Sonnet + `effort: low`, hemat token lebih jauh
  dibanding sesi utama ngerjain sendiri.
- Gak ada padanan langsung untuk mode "plan" opencode (yang minta konfirmasi
  sebelum edit/bash) — di Claude Code, minta eksplisit di prompt: "jangan
  edit dulu, jelaskan rencana dan tunggu konfirmasi saya" untuk perubahan
  besar.

## 8. Urutan kerja untuk fitur baru (preferensi user, 23 Jul 2026)

Untuk fitur baru ke depannya: **kerjakan backend + Angular dev-shell
langsung** (bukan lagi ui-demo.html dulu — preferensi user berubah 24 Jul,
sekarang trial-and-test langsung di Angular). `ui-demo.html` tetap harus
disinkronkan sebagai ground truth visual, tapi bukan lagi tempat uji coba
interaktif utama.
