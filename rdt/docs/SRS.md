# Software Requirements Specification
## Repost Detail Transaksi (RDT) — Modul Budgeting/TAB

Version 1.2 draft — updated setelah konfirmasi stack bersama tim IT (17 Jul 2026)
Prepared by Muhammad Abil Hasan — Divisi TAB, GMF AeroAsia

> **Catatan buat coding agent (opencode)**: dokumen ini adalah sumber kebenaran (source of truth) requirement bisnis untuk modul RDT. Baca seluruh dokumen ini SEBELUM menulis kode, terutama bagian 3.2 (Cross-Department Ledger Routing) yang berisi aturan atomicity/rollback yang tidak boleh disederhanakan tanpa konfirmasi ke pemilik proyek.

---

## 0. Perubahan Penting (v1.2)

Setelah rapat dengan tim IT GMF, beberapa asumsi arsitektur di versi sebelumnya (v1.1, berbasis Streamlit/Python standalone) **tidak berlaku lagi**. Perubahan kunci:

- **RDT bukan aplikasi berdiri sendiri.** RDT adalah satu **modul/route baru di dalam aplikasi web internal GMF yang sudah ada** (portal disebut pengguna sebagai "OCX", diakses melalui `*.gmf-aeroasia.co.id`, dengan alur Sign In → Select Platform → pilih fitur). RDT akan muncul sebagai salah satu opsi fitur di halaman "Select Platform", di samping fitur lain seperti CAPEX dan OPEX.
- **Tech stack mengikuti stack tim IT**, bukan Streamlit lagi:
  - Frontend: **Angular** (sebagai module/route baru di codebase Angular yang sudah ada)
  - Backend: **Node.js** (sebagai service/route baru di codebase Node yang sudah ada)
  - Database: **PostgreSQL** (tetap, sesuai rencana awal — kemungkinan besar instance yang sama dengan aplikasi IT lainnya, dengan schema terpisah, lihat 2.5)
- **Login, session, dan IP whitelisting sudah ditangani oleh platform (OCX)**, bukan dibangun sendiri oleh modul RDT. Section 3.6 di versi awal (Intranet IP-based Security) sebagian besar sudah diwariskan dari platform induk — yang jadi tanggung jawab RDT hanyalah **otorisasi tingkat fitur** (siapa yang boleh membuka menu RDT dan bertindak sebagai dinas tertentu), bukan autentikasi dari nol.
- **Permintaan baru (belum settled)**: pemilik proyek ingin modul ini bisa diakses dari luar kantor (remote/WFH), bukan cuma intranet. Ini bukan keputusan yang bisa diambil sepihak dari sisi RDT — lihat 2.7 untuk kenapa dan apa yang perlu dikonfirmasi ke tim IT/security dulu.
- **GMF sudah punya basis data pengguna (orang-orang TAB dan kemungkinan seluruh dinas)** yang dikelola tim IT. RDT harus **memanfaatkan tabel pengguna yang sudah ada ini** untuk otorisasi berbasis fitur/role, bukan membuat tabel user baru dari nol. *(Asumsi: perlu dikonfirmasi ke tim IT nama tabel/skema dan cara query-nya — lihat Open Questions di bagian akhir.)*
- Karena RDT numpang di infrastruktur yang sudah dikelola IT, **IRS versi awal (VM terpisah, Docker, provisioning jaringan) sebagian besar tidak relevan lagi** — lihat dokumen IRS v1.2 yang sudah diperbarui menyesuaikan ini.
- Konsekuensi penting: **tim IT yang akan maintain kode ini ke depannya.** Semua keputusan implementasi (struktur folder, penamaan, pola state management, pola API) harus mengikuti konvensi codebase Angular/Node mereka yang sudah ada, bukan pola baru yang asing bagi mereka.

Business logic inti (ledger routing, atomicity, audit trail, SAP export) **tidak berubah** — itu independen dari pilihan framework FE/BE.

---

## 1. Introduction

### 1.1 Purpose

RDT menggantikan proses rekonsiliasi manual berbasis email/Excel dengan dua fungsi utama:

- **Enterprise Ledger Reconciliation**: mengelola alur konfirmasi silang antar 21 dinas dengan sistem double-entry untuk perpindahan beban anggaran.
- **SAP Data Flattening**: mengekstraksi dan menstandardisasi data yang telah 100% tervalidasi menjadi matriks tabular untuk diintegrasikan ke sistem SAP.

### 1.2 Konteks Platform

RDT adalah satu modul dalam satu platform web internal Divisi TAB yang ke depannya akan menaungi modul lain: **IBT (Interoffice Billing Transaction)** serta kegiatan profitability/budgeting lainnya. Modul-modul ini berbagi infrastruktur platform yang sama: autentikasi, basis data (dengan schema terpisah per modul), dan jaringan — semuanya di bawah pengelolaan tim IT GMF.

### 1.3 Priority Convention

- **Tinggi (High)**: MVP mutlak untuk mengamankan rekonsiliasi data dan koneksi SAP.
- **Menengah (Medium)**: meningkatkan UX (komentar berulir, dashboard analitik).
- **Rendah (Low)**: eksploratif untuk pengembangan mendatang.

REQ ID menggunakan format `REQ-RDT-<MODUL>-<NOMOR>` agar unik secara global dan tidak bentrok dengan REQ ID modul lain (IBT, dst).

---

## 2. Overall Description

### 2.1 Product Perspective

RDT adalah modul di dalam platform Angular/Node.js yang sudah berjalan di intranet GMF. RDT bertindak sebagai **staging area / gatekeeper** antara input manual 21 dinas dan sistem ERP SAP, memastikan data tervalidasi 100% sebelum diekspor.

### 2.2 User Classes and Characteristics

- **TAB (Super User)**: memantau semua status pending/approved dan dashboard transparansi dari ke-21 dinas; satu-satunya kelas yang bisa mengeksekusi ekspor final ke SAP.
- **PIC Dinas Lintas (Standard User)**: representasi operasional dari 21 dinas; dibatasi row-level security — hanya bisa melihat/memvalidasi/berkomentar pada transaksi yang melibatkan dinas mereka sendiri.

Otorisasi kedua kelas ini idealnya di-resolve dari tabel pengguna yang sudah dikelola tim IT (lihat REQ-RDT-AUTH-01).

### 2.3 Operating Environment

- Frontend: Angular, sebagai module/route baru di aplikasi portal GMF yang sudah ada.
- Backend: Node.js, sebagai service/route baru di codebase backend yang sudah ada.
- Database: PostgreSQL, dengan schema/namespace terpisah untuk RDT (lihat 2.4).
- Akses jaringan saat ini: intranet GMF (mewarisi kebijakan platform OCX). Ada permintaan agar bisa diakses dari luar kantor — status: **belum settled, pending konfirmasi IT/security** (lihat 2.7).

### 2.4 Design and Implementation Constraints

- Struktur folder, konvensi penamaan, state management pattern, dan pola pemanggilan API **harus mengikuti konvensi yang sudah dipakai di codebase Angular/Node tim IT** — bukan membuat pola baru.
- Schema database harus dipisah per modul (misal schema `rdt` untuk Repost Detail Transaksi) di instance PostgreSQL yang sama, untuk mengantisipasi modul lain (IBT, dst.) tanpa konflik penamaan tabel.
- Otentikasi/sesi pengguna mengikuti shared authentication layer platform (token/session yang sudah dikeluarkan saat login di portal); RDT tidak membangun sistem login sendiri.

### 2.5 User Documentation

Panduan Pengguna (User Manual) disusun mendekati UAT/rollout, setelah UI final, mengacu pada alur nyata (bukan didesain dari SRS semata).

### 2.6 Non-Functional Requirements (placeholder)

Target concurrent user, response time, dan strategi caching akan divalidasi bersama tim IT pada iterasi berikutnya, menyesuaikan hasil load testing awal di lingkungan Angular/Node mereka.

### 2.7 Permintaan Akses dari Luar Kantor (Remote Access) — Open Item

Pemilik proyek ingin PIC dinas bisa mengakses RDT dari luar jaringan kantor (remote/WFH), bukan cuma dari intranet seperti asumsi awal. Ini **belum dianggap requirement final** karena dua alasan:

1. **Bukan keputusan RDT sendirian.** Modul ini numpang di platform OCX yang sudah ada; siapa yang bisa mencapai domain platform ini dari luar sama sekali itu keputusan infrastruktur jaringan tim IT (firewall/DNS/reverse proxy), bukan sesuatu yang bisa diubah hanya lewat kode Angular/Node di modul RDT.
2. **Data yang ditangani adalah ledger anggaran finansial.** Membuka akses dari luar jaringan kantor menambah permukaan serangan. Kalau disetujui, minimal butuh: HTTPS end-to-end, autentikasi yang lebih kuat dari sekadar IP whitelist (idealnya MFA), dan sebaiknya tetap lewat VPN korporat resmi ketimbang expose langsung ke internet publik.

`REQ-RDT-ACCESS-01` *(tentative, pending konfirmasi tim IT/security)*: Jika akses dari luar kantor disetujui, request harus tetap melewati mekanisme autentikasi platform (VPN dan/atau MFA) sebelum mencapai route RDT — modul RDT sendiri tidak membuka endpoint publik tanpa lapisan ini.

> **Untuk coding agent**: jangan implementasikan endpoint yang sengaja bisa diakses langsung dari internet publik tanpa lapisan di atas, meskipun untuk kemudahan development. Kalau butuh akses dari luar untuk testing, tanyakan ke pemilik proyek dulu.

---

## 3. System Features

### 3.1 Excel Multi-Sheet Extraction & Inisiasi Data

**Priority:** High

Membaca unggahan file Excel dari pengguna (sheet rekapitulasi + sheet detail), memecahnya menjadi baris data individual di PostgreSQL.

> **PENTING**: requirement di bawah sudah direvisi berdasarkan analisis file input nyata dari salah satu dinas (`contoh_input/06. DT TB - Jun 2026.xlsx`). Baca section 3.1.1 (Struktur File Input Nyata) sebelum implementasi — struktur aslinya jauh lebih kompleks dari asumsi "satu template standar".

**Functional Requirements**
- `REQ-RDT-EXT-01`: Sistem harus memiliki parser (backend Node.js) yang dapat membaca dan mengekstrak data dari beberapa sheet Excel sekaligus tanpa intervensi manual. Parser harus mengidentifikasi sheet detail transaksi **berdasarkan isi header-nya** (baris pertama diawali kolom `Account`, `Cost Ctr`, `Profit Ctr`, ...), bukan berdasarkan nama sheet — karena nama sheet berbeda-beda per dinas dan per bulan. Sheet pivot/rekap diidentifikasi dengan aturan terpisah (lihat REQ-RDT-EXT-07) dan sheet referensi lookup (lihat 3.1.1) harus di-skip, bukan diekstrak sebagai transaksi.
- `REQ-RDT-EXT-02`: Sistem harus menginisialisasi baris transaksi baru dengan memetakan atribut `dinas_inisiasi`, `dinas_target`, `nominal` (dari kolom `In PCLC`), dan mengatur `status_konfirmasi` menjadi `PENDING`. `dinas_target` diturunkan dari prefix kolom `Remarks` (mis. `"TC - TC WBS"` → `TC`) setelah melalui normalisasi kode dinas (lihat REQ-RDT-EXT-04). Baris yang target-nya adalah dinas pengunggah sendiri atau masuk kategori eksklusi (lihat REQ-RDT-EXT-05) TIDAK diinisialisasi sebagai transaksi lintas dinas.
- `REQ-RDT-EXT-03`: Sistem harus memvalidasi isi data pada setiap baris yang diekstrak: kelengkapan kolom wajib (kolom kontrak minimum, lihat 3.1.1), format numerik pada kolom nominal, serta deteksi duplikasi transaksi. **Nilai nominal negatif adalah sah** apabila baris teridentifikasi sebagai reversal/accrual (mis. remark mengandung "Reverse accrue") — jangan menolak nominal negatif secara buta. Baris yang gagal validasi ditolak secara spesifik (bukan seluruh file) dan dilaporkan ke pengguna beserta alasannya.
- `REQ-RDT-EXT-04`: Normalisasi kode dinas harus disimpan sebagai **tabel mapping di database** (bukan hardcode). Contoh mapping yang sudah terverifikasi dari data nyata: `TCR` → `TC`, `TJ Plant` → `TJ`. Mapping harus bisa ditambah oleh TAB tanpa perubahan kode.
- `REQ-RDT-EXT-05`: Aturan eksklusi baris (baris yang tidak dijadikan transaksi lintas dinas) harus eksplisit dan configurable. Dari data nyata: baris dengan prefix Remarks = kode dinas pengunggah sendiri (internal), `AUAK`, dan `PO` di-exclude dari rekap tagihan lintas dinas. Baris yang di-exclude tetap boleh disimpan sebagai data mentah (untuk audit), tapi tidak berstatus PENDING.
  > **Bug data ditemukan 3 Agu, MEMBURUK 4 Agu**: repost TB nunjukin 4.346 baris
  > EXCLUDED (3 Agu), lalu di percobaan berikutnya (4 Agu) NAIK jadi **7.856**,
  > padahal file Excel sumbernya SENDIRI cuma punya 469 baris DT. Angka yang
  > MEMBESAR di percobaan berikutnya (bukan cuma salah hitung statis) itu sinyal
  > kuat ada AKUMULASI yang gak di-reset antar percobaan repost — kemungkinan:
  > data lama gak dibersihkan sebelum parse ulang, atau upload berkali-kali
  > numpuk hasil parsing sebelumnya alih-alih ganti/replace. **INI PRIORITAS
  > MUTLAK NOMOR 1** di atas semua requirement lain di dokumen ini — investigasi
  > dan pahami akar masalahnya SAMPAI TUNTAS sebelum menyentuh fitur/bug lain
  > manapun, karena ini bug INTEGRITAS DATA finansial yang aktif memburuk, bukan
  > sekadar kosmetik. Laporkan akar masalahnya ke pemilik proyek SEBELUM
  > memperbaiki, jangan langsung tembak solusi.
  > **DIINVESTIGASI & SELESAI 4 Agu — BUKAN bug, false alarm**: 8.373 total baris
  > = 469 PENDING + 48 NEEDS_REVIEW + 7.856 EXCLUDED (4.346 self-repost TB→TB +
  > 3.510 prefix AUAK/PO). Kenaikan dari 4.346→7.856 ternyata konsekuensi BENAR
  > dari fix sebelumnya (commit `3c2d8f5`) yang membetulkan baris AUAK/PO yang
  > tadinya salah kehitung sebagai NEEDS_REVIEW, sekarang benar masuk EXCLUDED
  > sesuai aturan asli. `/api/parse` (preview) juga terkonfirmasi cuma parse
  > in-memory, gak pernah nyentuh database — gak ada jalur akumulasi lintas
  > upload untuk angka preview ini. Ditutup, tidak perlu tindakan lebih lanjut
  > untuk angka EXCLUDED preview itu sendiri.
  >
  > **Temuan sampingan 4 Agu yang BENERAN perlu ditindaklanjuti**: `/api/persist`
  > (commit ke database, beda dari `/api/parse` preview) TIDAK PERNAH invalidate
  > upload sebelumnya dari dinas yang sama sebelum insert yang baru — fully
  > additive, terbukti `rdt.uploads` untuk TB punya 4 baris upload terpisah yang
  > semuanya masih "hidup". Kalau upload kedua untuk PERIODE YANG SAMA (REQ-RDT-
  > SAP-13) betulan di-persist, transaksi lama nyangkut selamanya dan bisa
  > ke-agregasi dobel di query dashboard yang belum di-scope per `upload_id`.
  >
  > `REQ-RDT-EXT-10` **(baru 4 Agu, keputusan default — pola sama seperti share-cost
  > section 3.10, PENDING-only demi keamanan)**: Saat `/api/persist` menerima upload
  > baru untuk `(dinas_inisiasi, periode)` yang SUDAH PUNYA upload aktif sebelumnya:
  > 1. Upload lama ditandai **`SUPERSEDED`** (kolom `status` baru di `rdt.uploads`,
  >    BUKAN dihapus — tetap ada untuk audit trail).
  > 2. Transaksi dari upload lama yang MASIH `PENDING` ikut di-supersede/dikeluarkan
  >    dari agregasi aktif (dashboard, antrian konfirmasi, dst).
  > 3. Transaksi dari upload lama yang SUDAH `CONFIRMED`/punya `ledger_entries`
  >    JANGAN disentuh otomatis — itu komitmen finansial yang sudah terjadi. Kalau
  >    ada baris CONFIRMED di upload yang mau di-supersede, STOP, laporkan konflik
  >    ini ke pemilik proyek dulu sebelum lanjut (jangan asumsikan solusinya).
  > 4. Semua query agregasi (`dashboard.js` dan lainnya) HARUS di-scope supaya cuma
  >    menghitung transaksi dari upload berstatus aktif (bukan `SUPERSEDED`).
  >
  > **IMPLEMENTED 4 Agu**: poin 2/3 di atas DIKOREKSI project owner sebelum eksekusi —
  > bukan whitelist status (`PENDING` vs `CONFIRMED`) yang menentukan block-vs-supersede,
  > tapi FAKTA langsung: apakah transaksi itu punya baris di `rdt.ledger_entries` atau
  > tidak (diverifikasi ke kode: hanya `routes/confirmation.js`'s jalur CONFIRMED yang
  > pernah menulis `ledger_entries`; `BORNE_BY_INITIATOR` TIDAK, sesuai komentar header
  > `reassignment.js` sendiri). Jadi: ada `ledger_entries` -> blokir (409, tidak ada yang
  > disentuh); tidak ada -> aman disupersede — ini otomatis mencakup PENDING/DECLINED/
  > BORNE_BY_INITIATOR/NEEDS_REVIEW/NEEDS_INVESTIGATION sekaligus tanpa hardcode nama
  > status satu-satu. Baris yang sudah inert (EXCLUDED/INVALID/SPLIT_VOID) sengaja TIDAK
  > ikut di-flip walau juga tak punya `ledger_entries` — statusnya tetap aslinya karena
  > tak pernah dihitung di query agregasi manapun, jadi flip cuma akan menghapus info
  > diagnostik tanpa mengubah perilaku apapun. Poin 4 diimplementasikan lewat status baru
  > `SUPERSEDED` (migrasi 013) yang sengaja tidak masuk whitelist status manapun di
  > `dashboard.js`/`exportBatches.js`/`confirmation.js`/`investigation.js` (diverifikasi
  > satu-satu) — sama seperti pola `SPLIT_VOID` (section 3.10) — jadi TIDAK ADA perubahan
  > query di file-file itu. Diverifikasi via `test/supersedeCheck.test.js` (6 test) +
  > `npm test` (61/61 hijau) + 3 skenario live lewat backend sungguhan: (a) re-persist TJ
  > periode yang sama dengan upload CONFIRMED aktif -> 409, DB tidak berubah sama sekali;
  > (b) re-persist TB ke upload lama yang kosong (0 transaksi nyata) -> sukses, upload
  > lama jadi SUPERSEDED; (c) re-persist TB lagi ke upload yang sekarang punya baris
  > PENDING/NEEDS_REVIEW sungguhan -> 517 baris ikut ter-flip ke SUPERSEDED, baris
  > EXCLUDED (7.856) tidak tersentuh, dan query bergaya dashboard cuma menghitung upload
  > aktif terbaru (tidak dobel lagi).
- `REQ-RDT-EXT-06`: Parser harus membaca **nilai hasil kalkulasi (computed values)**, bukan string formula — sebagian besar kolom setelah `Value Date` di file nyata berisi formula `XLOOKUP`/referensi sel, bukan nilai statis. Pastikan library pembaca Excel yang dipakai (mis. exceljs/SheetJS di Node.js) dikonfigurasi membaca cached values.
- `REQ-RDT-EXT-07` **(baru 22 Jul, menggantikan asumsi nama sheet pivot sebelumnya)**: Sheet pivot/summary diidentifikasi dengan salah satu dari dua aturan (OR, bukan AND): (a) nama sheet mengandung kata "summary" secara case-insensitive (mis. "Summary", "summary", nama gabungan yang memuat kata itu), ATAU (b) sel `A3` pada sheet tersebut berisi teks "Sum of In PCLC". Sheet yang cocok salah satu aturan ini di-skip dari ekstraksi transaksi (bukan sumber data, cuma agregasi tampilan) — sesuai definisi di 3.1.1 poin 1. Jangan bergantung pada pola nama sheet spesifik dinas (mis. "DT TB - June 2026") karena terbukti tidak konsisten antar dinas.
- `REQ-RDT-EXT-08` **(baru 22 Jul)**: Sistem harus menyimpan file Excel ASLI yang diunggah (byte utuh, bukan cuma hasil ekstraksi) ke penyimpanan file server (mis. `src/uploads/`), dengan path/nama file direferensikan dari kolom baru `original_file_path` di `rdt.uploads`. Ini diperlukan untuk REQ-RDT-LEDGER-09 (download file asli dengan formula hidup) — tanpa ini, formula pada file asli hilang permanen setelah parsing karena parser cuma membaca computed values (REQ-RDT-EXT-06).
- `REQ-RDT-EXT-09` **(baru 25 Jul, strategi fallback berbasis pivot)**: Struktur sheet detail transaksi TERBUKTI bervariasi liar antar dinas (lihat 3.1.2) — bukan cuma nama kolom beda, tapi jumlah kolom, urutan, bahkan keberadaan sheet detail itu sendiri bisa gak konsisten. Daripada membangun heuristik deteksi yang makin kompleks untuk tiap variasi skema yang mungkin muncul dari 20 dinas, parser HARUS punya fallback yang selalu bisa diandalkan:
  1. **Coba dulu deteksi sheet detail ala-TB** (REQ-RDT-EXT-01: cari sheet dengan header berisi `Account`/`Cost Ctr`/`Profit Ctr` di kolom-kolom awal). Kalau ketemu dan valid → ekstrak row-level penuh (granularitas transaksi individual, seperti sekarang).
  2. **Kalau gagal/gak ada sheet yang cocok** (file "anomali"): fallback ke sheet pivot/summary yang SUDAH pasti ada (REQ-RDT-EXT-07 sudah reliable terbukti di 2 dinas berbeda). Generate satu baris transaksi SINTETIK per sel pivot yang punya nilai (Row Label × Column Label → In PCLC), KECUALI baris/kolom Grand Total. `dinas_target` = Column Label pivot (perlu normalisasi sama seperti REQ-RDT-EXT-04, karena bisa berupa kode yang belum ada di mapping — lihat 3.1.2), `category` = Row Label pivot, `nominal` = nilai sel.
  3. Baris hasil fallback pivot HARUS ditandai eksplisit berbeda dari baris hasil ekstraksi detail penuh (kolom/flag baru, mis. `granularity: 'PIVOT_DERIVED'` vs `'DETAIL_ROW'`) — karena baris ini TIDAK punya document number/tanggal/cost center per-transaksi, cuma agregat. UI (Confirmation, dashboard) harus menampilkan indikator ini supaya PIC yang review tau ini bukan transaksi individual.
  4. TB sebagai contoh PALING LENGKAP/ideal (jalur 1) tetap jadi acuan utama kalau strukturnya cocok — fallback pivot (jalur 2) BUKAN pengganti, cuma jaring pengaman supaya file dengan struktur gak terduga tetap bisa diproses alih-alih ditolak total.

#### 3.1.1 Struktur File Input Nyata (hasil analisis contoh dari dinas TB, Jun 2026)

> **UPDATE 22 Jul**: ada contoh file kedua dari dinas TJ
> (`contoh_input/06. DT TJ JUN 2026 R1.xlsx`) dengan kemungkinan nama sheet pivot yang
> BEDA dari file TB (yang namanya `DT TB - June 2026`). Aturan deteksi sheet pivot/
> summary di REQ-RDT-EXT-01 sudah diperbarui supaya tidak bergantung pada pola nama
> `DT <dinas> - <bulan> <tahun>` yang ternyata tidak konsisten antar dinas — lihat
> aturan baru di bawah. **Ini belum diverifikasi empiris terhadap file TJ** (belum
> dibuka/dianalisis) — verifikasi ini didelegasikan ke coding agent karena binary
> Excel tidak bisa dibaca lewat kanal MCP filesystem yang dipakai untuk menulis
> dokumen ini; coding agent punya akses langsung ke file di disk.

File contoh: `budgeting_gmf/contoh_input/06. DT TB - Jun 2026.xlsx` — 9 sheet, 3 peran:

1. **Sheet pivot/rekap** (`DT TB - June 2026`): pivot table. Baris = kategori GL (`Expendable-Material`, `Repairable-Material`, `Spare parts scrap`), kolom = dinas target (`Corp`, `TC`, `TF`, `TJ`, `TL`, `TN`), nilai = `Sum of In PCLC`. Bukan sumber data — hasil agregasi dari sheet detail.
2. **Sheet detail transaksi** (`Subcont` 48 baris, `Material` 8.325 baris): sumber data utama, format export SAP + kolom tambahan manual/formula.
3. **Sheet referensi lookup** (`SQ00`, `ziw29`, `po`, `WBS`, `IW38`, `GL`): tabel bantu SAP yang dipakai formula XLOOKUP di sheet detail. BUKAN transaksi — harus di-skip parser.

**Kontrak kolom:**
- Kolom 1–53 (`Account` s/d `Value Date`) **identik** di semua sheet detail — ini kontrak minimum yang boleh diwajibkan parser.
- Kolom setelah `Value Date` **bervariasi per dinas/sheet** (Subcont: `Desc`, `Ac reg`, `Remark`, `GL`; Material: `Order`, `WBS`, `ACREG`, `Type Main`, `Notif`, `Document`, `Interval`, `Dinas`, `Remarks`, `GL`). Baca by name, best-effort — jangan by position, jangan diwajibkan.

**Logika pivot yang terverifikasi (angka match 100% dengan rekap):**
- Nominal = kolom `In PCLC`.
- Dinas target = prefix kolom `Remarks` sebelum tanda `-`.
- Normalisasi: `TCR`→`TC` (5.926,66 + 79.385,55 = 85.312,21 ✓), `TJ Plant`→`TJ` (37.358,59 + 8.994,78 = 46.353,37 ✓).
- Eksklusi: prefix `TB` (dinas sendiri), `AUAK`, `PO` tidak masuk rekap.
- Kategori baris = kolom `GL` (hasil XLOOKUP account number → sheet `GL`).
- Terdapat nilai negatif sah (reversal accrual) — lihat REQ-RDT-EXT-03.

#### 3.1.2 Variasi Struktur Antar Dinas (temuan 25 Jul, file contoh TJ tambahan)

Dua file contoh tambahan dari dinas TJ ternyata mengungkap variasi yang jauh lebih liar dari dugaan:

- **`06. DT TJ - Jun 2026.xlsx`**: cuma berisi sheet pivot (identik 100% dengan sheet `Summary` di file R1 di bawah) — TIDAK ADA sheet detail sama sekali. Ini contoh nyata kasus "file anomali" yang butuh fallback REQ-RDT-EXT-09 jalur 2.
- **`06. DT TJ JUN 2026 R1.xlsx`**: 5 sheet — `Summary` (pivot), `DT TJ JUN 2026 R1` (detail utama, 490 baris, 59 kolom — skema BEDA TOTAL dari TB: diawali `Group, Sub Group, Account, Cost Ctr, ...`, bukan langsung `Account`), plus 3 sheet breakdown per pasangan dinas (`TJ-TE`, `TJ-TMM`, `TJ-Scrap`) dengan skema lain lagi (`Cost.Ctr1, Cost.Element, Amount, Curr., Cost.Ctr2, Qty, UoM, Text`).

**Sudah diverifikasi (25 Jul)**: grouping sheet detail utama berdasarkan kolom `Review TJ` (kolom ke-57, berisi kode dinas langsung, BUKAN prefix teks kayak Remarks di TB) menghasilkan angka yang **match 100%** ke pivot: TMM=473.933,51 (475 baris), TA=1.653,24 (11 baris), TE=84,36 (1 baris), Ask TA=40.393,29 (3 baris). Tiga sheet breakdown (`TJ-TE`/`TJ-TMM`/`TJ-Scrap`) TERNYATA gak reliable — `TJ-TE` & `TJ-Scrap` cocok ke subset data utama, tapi `TJ-TMM` beda ~150rb dari yang seharusnya (kemungkinan data manual yang basi/gak lengkap). **Keputusan: 3 sheet breakdown itu di-skip, jangan diparse** (REQ-RDT-EXT-09 tidak berlaku ke sheet ini, cukup skip seperti sheet referensi biasa).

**Kode dinas baru yang ditemukan, BELUM ada di `dinas_mapping`/`rdt.dinas`** — perlu keputusan bisnis sebelum di-hardcode:
- `TA` — **KEPUTUSAN FINAL 31 Jul**: `TA` adalah dinas operasional sendiri dengan PIC sendiri, BUKAN sinonim TAB. Lihat REQ-RDT-AUTH-05 untuk detail koreksi ini.
- `Ask TA` — **SUDAH TERJAWAB 27 Jul**: ini BUKAN dinas, ini penanda "perlu investigasi TAB" — lihat REQ-RDT-LEDGER-10 untuk alur lengkapnya. Jangan dimasukkan ke `dinas_mapping` sebagai dinas biasa. **Beda dari dinas `TA` di atas** — jangan disamakan meski namanya mirip.
- `TMM` — kode 3 huruf, di luar pola 2-huruf (`TB`–`TU`) yang selama ini diasumsikan sebagai roster 20 dinas. **Ditegaskan ulang 31 Jul oleh TAB**: `TMM` itu **dinas/sub-dinas terpisah dari `TM`**, punya urusan repost yang beda — sistem TIDAK BOLEH punya logic apapun yang menyamakan keduanya (mis. ambil 2 huruf pertama dari kode 3 huruf lalu anggap sama dengan versi 2 hurufnya). Ini larangan eksplisit, bukan sekadar catatan — audit kode yang ada sekarang untuk mastiin gak ada heuristik semacam itu di manapun (parser, mapping, normalisasi).
- `TZ` **(baru 27 Jul)** — muncul sebagai hasil investigasi kasus "Ask TA" (lihat contoh di REQ-RDT-LEDGER-10), kode 2 huruf tapi di luar rentang alfabet `TB`–`TU` yang diasumsikan sebelumnya. Sama seperti `TMM`, ini kode dinas asli yang masih perlu ditambahkan ke roster resmi.

> **Untuk coding agent**: JANGAN menebak sendiri arti `TA`/`Ask TA`/`TMM` dan langsung menambahkannya ke `dinas_mapping`/`rdt.dinas` — ini pertanyaan bisnis yang masih menunggu jawaban pemilik proyek, bukan keputusan teknis. Untuk sementara, biarkan kode-kode ini masuk status `NEEDS_REVIEW` (REQ-RDT-EXT-01 sudah mendefinisikan status ini untuk prefix tak dikenal) alih-alih ditolak total atau ditebak mapping-nya.

### 3.2 Cross-Department Ledger Routing (Validasi Silang)

**Priority:** High — ini bagian paling kritis dari seluruh sistem.

Mesin status (state machine) double-entry: dinas target memvalidasi tagihan.

> **UPDATE 20 Jul (flowchart & konsep UI pemilik proyek)** — semantik validasi adalah **klaim kepemilikan**: "Ya" = transaksi milik dinas kami (CONFIRMED, beban berpindah), "Tidak" = bukan milik kami (DECLINED). Transaksi DECLINED tidak berhenti: dinas pengaju memilih **menanggung sendiri** (BORNE_BY_INITIATOR) atau **mengajukan ulang ke dinas lain** (reassign → kembali PENDING dengan jejak `reassigned_from` & `reassign_count`). Istilah APPROVED/REJECTED di versi sebelumnya diganti CONFIRMED/DECLINED.

**Functional Requirements**
- `REQ-RDT-LEDGER-01`: Sistem harus memfilter tampilan data sehingga pengguna hanya dapat melihat dan memvalidasi transaksi yang melibatkan dinasnya.
- `REQ-RDT-LEDGER-02`: Update status kepemilikan anggaran saat Approve/Reject harus atomic.
- `REQ-RDT-LEDGER-03` **(non-negotiable, jangan disederhanakan tanpa konfirmasi)**: Sistem harus membungkus operasi debit dinas asal dan kredit dinas tujuan dalam satu transaksi database tunggal (`BEGIN...COMMIT`). Jika salah satu operasi gagal (constraint violation, koneksi terputus, dll), sistem harus `ROLLBACK` penuh — tidak boleh ada kondisi di mana saldo satu dinas ter-update sementara dinas lainnya tidak.
- `REQ-RDT-LEDGER-04`: Sistem harus menerapkan row-level locking (`SELECT ... FOR UPDATE`) pada baris transaksi yang sedang diproses Approve/Reject, untuk mencegah dua proses memvalidasi baris yang sama secara bersamaan.
- `REQ-RDT-LEDGER-05`: Sistem harus menampilkan notifikasi kegagalan transaksi ke pengguna beserta kategori penyebab (konflik konkurensi/data tidak valid/koneksi terputus), dan mencatat setiap kejadian rollback ke tabel log (lihat 3.6).
- `REQ-RDT-LEDGER-06`: Halaman konfirmasi per dinas hanya boleh diakses oleh: PIC dinas yang diminta mengonfirmasi, PIC dinas pengaju, dan pengguna TAB. Pengguna lain ditolak.
- `REQ-RDT-LEDGER-07`: Untuk transaksi DECLINED, ada dua jalur penyelesaian yang berlaku (dikonfirmasi ulang 23 Jul oleh pemilik proyek & pihak TAB):
  - **(a) Redirect langsung oleh dinas yang menolak**: saat submit "Tidak", dinas penolak boleh sekalian memilih `redirect_to` (dinas tujuan baru) — reassignment ini **langsung tereksekusi saat itu juga**, TANPA menunggu persetujuan dinas pengaju. Ini otoritas yang lebih luas dari draf awal requirement ini (yang cuma mengizinkan dinas pengaju yang memutuskan) — sudah dikonfirmasi eksplisit ke pemilik proyek dan disetujui pihak TAB, jangan dianggap bug/di-rollback.
  - **(b) Kalau dinas penolak TIDAK sekalian redirect**: transaksi masuk status DECLINED dan MENUNGGU dinas pengaju memutuskan salah satu dari: (b1) menanggung beban sendiri (status BORNE_BY_INITIATOR), atau (b2) mengajukan ulang ke dinas target berbeda sendiri (lewat alur reassignment terpisah).
  - Kedua jalur sama-sama mengisi `reassigned_from` & menaikkan `reassign_count` saat terjadi redirect, dan tercatat di audit log (action `REJECT_REDIRECT` untuk jalur (a), `REASSIGN` untuk jalur (b2)).
- `REQ-RDT-LEDGER-08`: Aksi submit konfirmasi (batch Ya/Tidak per halaman dinas) harus meminta dialog konfirmasi eksplisit ("Apakah kamu sudah yakin?") sebelum dieksekusi, dan seluruh perubahan dalam satu submit dibungkus satu transaksi database.
- `REQ-RDT-LEDGER-09` **(baru 22 Jul, keputusan sadar dengan trade-off privasi, disederhanakan)**: Halaman Confirmation harus punya tombol download file Excel ASLI (file utuh persis seperti yang di-upload, bukan hasil ekspor ulang) untuk upload yang jadi sumber transaksi di antrian konfirmasi itu. File asli sudah otomatis berisi sheet pivot (`Sum of In PCLC`) DAN sheet detail transaksi per-row sekaligus — tidak perlu logic pemilahan sheet apapun, cukup serve byte file-nya apa adanya.
  > **Trade-off yang disetujui pemilik proyek**: karena file asli tidak dipisah per dinas, file yang diunduh berisi data SEMUA dinas dalam upload itu, bukan cuma bagian dinas pengunduh — lebih luas dari yang mereka lihat di dalam aplikasi (REQ-RDT-LEDGER-01). Ini diterima karena setara dengan proses email manual sebelumnya (file yang sama sudah biasa dikirim utuh ke banyak dinas sekaligus).
  > Kalau satu antrian konfirmasi mengacu ke lebih dari satu file upload (mis. dari bulan/periode berbeda): tampilkan beberapa tombol download sederhana (satu per upload, label nama file/tanggal), TIDAK perlu endpoint/UI pemilihan terpisah — cukup daftar tombol langsung di halaman.
  > Akses ke tombol download ini tunduk pada otorisasi yang sama dengan halaman Confirmation itu sendiri (REQ-RDT-LEDGER-06, REQ-RDT-AUTH-04/05) — bukan celah baru untuk role yang sudah dibatasi.
- `REQ-RDT-LEDGER-10` **(baru 27 Jul, temuan makna "Ask TA")**: Kolom pivot `Ask TA` (lihat 3.1.2) BUKAN dinas target sungguhan — itu penanda transaksi yang kepemilikan dinas-nya AMBIGU dari data saja, butuh investigasi manual TAB (cross-check `Ref. Doc.`/PO, tanya ke dinas terkait) sebelum bisa ditentukan dinas_target yang benar. Ini beda dari `NEEDS_REVIEW` biasa (yang sekali dipetakan di mapping table beres selamanya) — "Ask TA" butuh keputusan kasus-per-kasus setiap muncul, gak bisa digeneralisasi jadi satu aturan mapping.
  - Baris dengan sinyal dinas_target = `"Ask TA"` (dari kolom Remarks/Review-style manapun, lihat REQ-RDT-EXT-02/EXT-09) mendapat status baru **`NEEDS_INVESTIGATION`**, BUKAN `PENDING` dan BUKAN `NEEDS_REVIEW`.
  - Baris berstatus `NEEDS_INVESTIGATION` masuk ke **antrian terpisah khusus role TAB** (bukan antrian konfirmasi dinas manapun) — PIC dinas lain TIDAK melihat baris ini sampai TAB menentukan arahnya.
  - Aksi TAB atas baris ini BUKAN Confirm/Reject — tapi **assign dinas_target yang benar** (reuse mekanisme redirect/reassignment yang sudah ada di `reassignment.js`). Begitu di-assign, baris pindah jadi `PENDING` dengan `dinas_target` baru hasil investigasi, `reassigned_from` diisi `'Ask TA'`, lalu masuk alur konfirmasi NORMAL (dinas yang baru ditentukan itu yang confirm/decline, BUKAN TAB).
  - Tercatat di audit log dengan action baru `INVESTIGATION_RESOLVED`.
  - Contoh nyata dari pemilik proyek (dinas TJ, Jun 2026): satu baris "Ask TA" ternyata dari `Ref. Doc.` menunjukkan PO milik `TZ` (kode dinas baru, belum ada di roster — lihat 3.1.2). TAB konfirmasi ke TZ, TZ bilang "itu barangnya beli kami, tapi yang kerjain TJ" — TAB akhirnya assign baris itu ke `TZ`. Ini contoh kasus di mana jawaban investigasi TIDAK selalu jelas/satu jawaban tunggal (ada nuance "yang beli vs yang kerjain") — keputusan akhir tetap di tangan TAB sebagai manusia, sistem cuma memfasilitasi routing-nya, JANGAN dibuat otomatis menebak.
  - **Tambahan 30 Jul (bulk assign)**: TAB harus bisa **pilih banyak baris investigasi sekaligus** (checkbox + "Select All") dan assign semuanya ke SATU dinas_target yang sama dalam satu aksi — berguna kalau ada beberapa baris "Ask TA" yang sudah jelas jawabannya sama (mis. semua ternyata punya TZ). Assign satu-per-satu tetap harus tersedia untuk kasus yang beda jawaban.
  - **Catatan penting (dikonfirmasi TAB, 30 Jul) — DIBALIK 5 Agu**: sebelumnya
    diputuskan dinas hasil investigasi TETAP harus melalui alur konfirmasi normal
    (Ya/Tidak) walau TAB sudah "memutuskan" secara informal, demi jejak dokumentasi
    resmi di sistem. **KEPUTUSAN INI DIBALIK 5 Agu**: assignment TAB dari antrian
    investigasi sekarang dianggap **SUDAH FINAL/FIX**, karena diskusi penentuan
    dinas yang benar SUDAH dilakukan lewat platform lain (WhatsApp dkk) DI LUAR
    sistem ini SEBELUM TAB melakukan assign. Begitu TAB assign dari antrian
    investigasi, transaksi itu **LANGSUNG masuk status resolved** (setara
    CONFIRMED) TANPA perlu dinas target melakukan aksi Confirm/Reject lagi —
    dinas target tetap bisa LIHAT transaksi itu (transparansi), tapi tidak perlu
    tindakan konfirmasi tambahan. Ini KHUSUS untuk hasil resolusi investigasi
    (REQ-RDT-LEDGER-10) — TIDAK mengubah alur konfirmasi normal untuk transaksi
    yang bukan hasil investigasi.

> **Bug baru ditemukan 5 Agu**: `GET /api/confirmation/TMM` mengembalikan **403
> Forbidden** saat diakses dari halaman `/rdt/confirm?from=TJ&target=TMM`.
> Investigasi dulu akar masalahnya (kemungkinan terkait perubahan role/otorisasi
> TA/TAB baru-baru ini) sebelum memperbaiki — laporkan temuannya.
>
> **Ditegaskan ulang 5 Agu**: input nomor subdoc (REQ-RDT-SAP-08/11) untuk pasangan
> yang di-chunk >300 baris HARUS punya kolom input TERPISAH per chunk (mis. "Repost
> 1: [input subdoc]", "Repost 2: [input subdoc]"), BUKAN satu input generik untuk
> semua chunk sekaligus.

### 3.3 SAP Flattening Gatekeeper / Need Approval

**Priority:** High

Mencegah ekspor final jika masih ada selisih rekonsiliasi; memformat data menjadi matriks SAP.

> **SUPERSEDED 30 Jul — model per PASANGAN (dinas pengaju × dinas target) + eksekusi
> paralel, menggantikan model per-dinas-pengaju 29 Jul yang TERNYATA SALAH.**
> Sumber: rapat langsung tim TAB (transkrip lengkap, 30 Jul). Ini koreksi penting:
>
> **Kenapa model 29 Jul salah**: waktu itu diasumsikan TAB harus nunggu SEMUA
> pasangan dari SATU dinas pengaju selesai baru bisa diproses sekaligus. Tim TAB
> sendiri awalnya mikir gitu, tapi LANGSUNG mengoreksi diri sendiri di rapat:
> kalau TJ mengajukan ke TE, TL, TM sekaligus dan TE telat konfirmasi, TAB harus
> tetap bisa proses TJ→TL dan TJ→TM lebih dulu tanpa nunggu TE — supaya TJ tidak
> dirugikan oleh keterlambatan pihak lain. **Unit approval yang benar adalah PER
> PASANGAN, diproses paralel/asinkron, BUKAN digabung per dinas pengaju.**
>
> `REQ-RDT-SAP-03` **(revisi 30 Jul)**: Satu entri antrian Need Approval muncul PER
> PASANGAN (dinas_inisiasi, dinas_target), begitu SEMUA transaksi pasangan itu
> spesifik berstatus resolved (CONFIRMED/BORNE_BY_INITIATOR, tidak ada PENDING/
> DECLINED/NEEDS_REVIEW tersisa UNTUK PASANGAN ITU). Pasangan lain dari dinas
> pengaju yang sama TIDAK menghalangi — tiap pasangan berjalan independen begitu
> siap, kapanpun itu terjadi.
>
> `REQ-RDT-SAP-04`: TAB harus bisa membuka **tampilan transparansi penuh** untuk
> satu entri (pasangan) — seluruh detail transaksi pasangan itu, termasuk yang
> CONFIRMED maupun yang sempat DECLINED/di-reassign (audit trail lengkap,
> termasuk riwayat redirect antar dinas kalau ada, mis. "TJ→TE→TL"), sebelum
> memutuskan approve.
>
> `REQ-RDT-SAP-05` **(REVISI 31 Jul dari presentasi progress — urutan sebelumnya
> KEBALIK, baca baik-baik)**: Alur yang BENAR (bukan yang sekarang terimplementasi):
> 1. Begitu pasangan masuk daftar "siap" (semua transaksi resolved), **download file
>    53-kolom LANGSUNG tersedia** — TIDAK perlu TAB klik "Confirm" dulu buat unlock
>    download. Status di titik ini otomatis "Waiting to repost" hanya karena statusnya
>    ready, bukan karena ada aksi TAB.
> 2. TAB download, lalu posting manual ke SAP DI LUAR sistem ini.
> 3. TAB balik ke web, dan aksi **"Confirm" yang sebenarnya = memasukkan nomor subdoc
>    (hasil dari posting SAP) BERSAMAAN dengan deskripsi penutup, dalam SATU aksi**
>    — bukan dua langkah terpisah (Confirm dulu baru subdoc belakangan seperti
>    implementasi sekarang). Begitu aksi ini submit, batch baru DIBUAT sekaligus
>    subdoc pertamanya langsung ke-attach, status langsung jadi "Reposted".
> 4. Kalau line item pasangan itu > 300 (limit SAP), sisanya pakai alur tambah-subdoc
>    yang sudah ada (REQ-RDT-SAP-08/11) SETELAH batch pertama itu dibuat di langkah 3.
>
> **Implikasi teknis**: endpoint export perlu bisa jalan berdasarkan `(dinas_inisiasi,
> dinas_target)` langsung untuk pasangan yang MASIH DI `/waiting` (belum ada batch
> sama sekali) — bukan cuma `GET /export/:batchId` yang sekarang (itu butuh batch
> sudah ada). Endpoint `POST /confirm` yang sekarang (bikin batch + closing_description
> doang, subdoc menyusul terpisah) perlu digabung jadi satu body yang SEKALIGUS terima
> `subdoc_number` pertama — hasil akhirnya sama kayak manggil `/confirm` lalu
> `/:batchId/subdocs` berturutan, tapi user-nya cuma ngisi SATU form, bukan dua
> langkah.
>
> `REQ-RDT-SAP-06`: File download 53 kolom kontrak penuh (Account s/d Value Date,
> lihat 3.1.1) untuk transaksi CONFIRMED pasangan itu — lihat REQ-RDT-SAP-05 poin 1
> soal KAPAN tombol ini muncul (lebih awal dari yang terimplementasi sekarang). Dinas
> TIDAK butuh rekap fancy dari sistem — sumber (transkrip rapat) menegaskan yang
> mereka cari cuma nomor **refdoc/subdoc** untuk cross-check ke rekapan internal
> mereka sendiri, jadi UI harus menonjolkan subdoc, bukan menyembunyikannya di balik
> file export.
> **Rename tombol (baru 3 Agu)**: tombol yang sebelumnya "Lihat Transparansi" di
> halaman Wait to Repost diganti jadi **"Confirm Reposted"** — mengklik tombol ini
> menampilkan data transparansi (REQ-RDT-SAP-04) SEKALIGUS form isi deskripsi
> penutup + nomor subdoc (satu layar, bukan dua langkah terpisah), dengan tombol
> **Confirm** di paling bawah yang mengeksekusi (sama seperti pola submit yang sudah
> ada di Confirmation). "Download" tetap tombol terpisah, tersedia dari sebelum
> "Confirm Reposted" diklik (lihat REQ-RDT-SAP-05 poin 1).
> **Dua bug ditemukan 3 Agu**:
> 1. Layar "Confirm Reposted" menampilkan SEMUA baris transaksi sekaligus (mis. 447
>    baris) tanpa pagination — harus pakai pagination yang sama (REQ-RDT-NAV-07,
>    100/halaman) seperti tabel lain, bukan nampilin semuanya jadi satu scroll
>    panjang.
> 2. Layar ini TIDAK BISA DITUTUP tanpa menyelesaikan Confirm — ini bug, HARUS ada
>    cara batal/tutup (tombol Cancel/X) yang bisa dipencet kapan saja tanpa
>    mewajibkan isi deskripsi+subdoc dulu, sama seperti pola Cancel di halaman
>    Repost (REQ-RDT-NAV-04).
> **Pemisahan file otomatis (baru 1 Agu)**: kalau transaksi CONFIRMED dalam satu
> pasangan lebih dari **300 baris** (limit SAP, sama seperti limit subdoc REQ-RDT-
> SAP-08), download HARUS otomatis terpecah jadi **beberapa file terpisah, masing-
> masing maksimum 300 baris DT** — bukan satu file raksasa yang TAB potong manual.
> Idealnya urutan pemotongan file ini konsisten dengan urutan yang nanti dipakai
> saat TAB memasukkan subdoc per chunk (REQ-RDT-SAP-11), supaya file 1 = subdoc 1,
> file 2 = subdoc 2, dst — tidak perlu TAB mencocokkan manual mana baris masuk file
> mana.
>
> `REQ-RDT-SAP-07` **(baru 30 Jul, state label dinamis; alur berubah per REQ-RDT-SAP-05
> revisi 31 Jul, tapi 3 label ini sendiri TETAP)**: Selain `status_konfirmasi`
> teknis yang sudah ada, sistem butuh **label status tampilan** yang menunjukkan
> siapa yang sedang "pegang bola" — dihitung/diturunkan, BUKAN kolom status baru yang
> menggantikan yang lama:
> - **`Waiting for confirmation [Role]`** — transaksi masih PENDING di satu atau
>   lebih dinas target; `[Role]` diisi kode dinas yang belum konfirmasi.
> - **`Waiting to repost`** — pasangan sudah resolved semua DAN belum ada subdoc sama
>   sekali (murni computed dari readiness, BUKAN dari ada/tidaknya aksi TAB — lihat
>   revisi SAP-05).
> - **`Reposted by TAB with subdoc [nomor]`** — minimal satu subdoc sudah masuk.
>   Bisa lebih dari satu nomor (lihat REQ-RDT-SAP-08).
>
> `REQ-RDT-SAP-08` **(baru 30 Jul, subdoc one-to-many)**: SATU pasangan bisa
> menghasilkan **LEBIH DARI SATU nomor subdoc** — SAP membatasi maksimum ~300
> line item per dokumen, jadi kalau transaksi dalam satu pasangan banyak, TAB
> memecah repost jadi beberapa subdoc. Skema database butuh relasi one-to-many
> (tabel baru, bukan kolom tunggal `subdoc` di `export_batches`/pasangan) — satu
> pasangan/batch bisa punya banyak baris subdoc, masing-masing bisa (opsional)
> menunjuk subset transaksi spesifik yang tercakup nomor itu.
>
> `REQ-RDT-SAP-09` **(baru 30 Jul, auto-archive)**: Begitu status pasangan jadi
> `Reposted by TAB with subdoc [...]`, baris itu HARUS otomatis hilang dari
> dashboard/antrian utama (Need Approval, Need to Confirm, Own Repost) dan
> pindah ke tampilan **Arsip/Riwayat** terpisah — supaya dashboard utama tetap
> ringan dan tidak numpuk data yang sudah selesai.
>
> `REQ-RDT-SAP-10` **(baru 30 Jul, section "Riwayat Repost TAB")**: Sebagai
> pengganti notifikasi email (yang butuh infra SMTP terpisah, DITUNDA untuk
> sekarang), buat section/halaman baru — nama & lokasi menyusul, isinya log
> semua aksi repost TAB (pasangan, dinas terkait, subdoc, deskripsi penutup,
> timestamp), bisa difilter per periode. Section ini SEKALIGUS jadi tujuan
> auto-archive di REQ-RDT-SAP-09 — satu fitur menjawab dua kebutuhan (arsip +
> log "kiriman" TAB yang bisa dicek dinas kapan saja), bukan dua fitur terpisah.
> PIC dinas terkait tetap dapat notifikasi in-app + komentar (REQ-RDT-COMMENT-03,
> sudah ada) saat pasangan mereka di-repost — section ini pelengkap yang bisa
> di-browse, bukan pengganti notifikasi yang sudah ada.
>
> `REQ-RDT-SAP-11` **(baru 31 Jul, gap ditemukan saat review kode)**: `rdt.export_subdocs`
> sekarang cuma `{batch_id, subdoc_number}` — TIDAK ada linkage ke transaksi spesifik.
> Kalau satu pasangan dipecah jadi beberapa subdoc (limit ~300 baris SAP), sistem
> HARUS bisa nunjukin baris transaksi mana masuk subdoc yang mana — bukan cuma
> daftar nomor subdoc tanpa konteks. Butuh linkage (kolom `subdoc_id` di
> `rdt.transactions`, atau tabel junction terpisah) yang diisi saat TAB memasukkan
> subdoc, idealnya dengan UI yang biarin TAB pilih/lihat baris mana yang tercakup
> di tiap nomor subdoc.
>
> `REQ-RDT-SAP-12` **(baru 31 Jul, gap ditemukan saat review kode; diperluas 31 Jul
> per ide pemilik proyek jadi "Riwayat Repost [Dinas]")**: Dinas PENGAJU (CBO)
> harus punya **arsip riwayat sendiri**, simetris dengan "Riwayat Repost TAB"
> (REQ-RDT-SAP-10) tapi di-filter ke pasangan yang dinas itu mulai saja —
> menampilkan status & nomor subdoc dari TAB untuk tiap pasangan, bisa difilter
> per periode sama seperti punya TAB. Ini BUKAN dua fitur terpisah dari SAP-10 —
> reuse endpoint/tabel yang sama (`rdt.export_batches` + `rdt.export_subdocs`),
> cukup beda scope filter (TAB lihat semua, dinas cuma lihat punya sendiri) dan
> beda otorisasi (bukan `requireRole('TAB')` doang, PIC dinas pengaju juga boleh
> akses versi milik mereka). Saat ini seluruh endpoint `export-batches` di-gate
> TAB-only, dan view "Own Repost" milik PIC dinas pengaju tidak menyertakan
> `state_label`/subdoc sama sekali — walau TAB sudah selesai repost, dinas
> pengaju gak akan pernah liat "Reposted with subdoc X" di dashboard mereka.
> Perlu endpoint read-only yang bisa diakses PIC dinas pengaju untuk pasangan
> yang mereka mulai, DAN `buildChainAwareProgress`/as_initiator view perlu
> disertain `state_label`.
>
> **Open question (periode/bulan berganti) — SEBAGIAN JADI REQUIREMENT 3 Agu**:
> Bug ditemukan: transaksi periode Juni yang baru di-repost TAB bulan Agustus
> kearsip di bulan Agustus (waktu aksi repost), PADAHAL harusnya kearsip ke Juni
> (periode transaksinya). Keputusan:
>
> `REQ-RDT-SAP-13` **(baru 3 Agu)**: Saat inisiasi Repost (upload), dinas pengaju
> HARUS eksplisit menyatakan **periode DT ini untuk bulan/tahun apa** (bukan
> diasumsikan dari tanggal upload). Arsip di Riwayat Repost TAB/Dinas (REQ-RDT-
> SAP-10/12) harus mengelompokkan berdasarkan **periode yang dinyatakan ini**,
> BUKAN tanggal repost/upload sebenarnya.
>
> `REQ-RDT-SAP-14` **(baru 3 Agu, tag Overdue)**: Kalau repost oleh TAB terjadi
> SETELAH periode yang dinyatakan (mis. periode Juni tapi baru di-repost Agustus),
> tampilkan tag **"Overdue"** berwarna merah di SAMPING tag "Reposted by TAB with
> subdoc [nomor]" (REQ-RDT-SAP-07) — dua tag berdampingan, bukan menggantikan.
>
> Detail lain (cara hitung "terlambat" persisnya, apakah ada grace period, dst)
> MASIH BELUM final — implementasikan versi paling sederhana dulu (bandingkan
> bulan/tahun periode vs bulan/tahun repost, telat = periode < bulan-tahun repost),
> tanya pemilik proyek kalau butuh nuansa lebih rinci.
>
> **Migrasi**: model per-dinas-pengaju (29 Jul) dan model batch global (24 Jul)
> **DIGANTI TOTAL** oleh model per-pasangan ini. Kalau ada kode yang sudah
> mengikuti model 29 Jul (gate nunggu semua pasangan satu dinas), itu HARUS
> direvisi sebelum dipakai — jangan dijalankan berdampingan, itu bakal
> membingungkan TAB soal antrian mana yang beneran real.

**Functional Requirements**
- `REQ-RDT-SAP-01`: Sistem harus menjalankan pengecekan status (`COUNT(*) WHERE status = 'PENDING'`) sebelum mengizinkan ekspor.
- `REQ-RDT-SAP-02`: Sistem harus mengubah data relasional menjadi format matriks flat-file (.csv/.xlsx) sesuai skema tabel impor SAP.

### 3.4 Dashboard Transparansi Alur

**Priority:** Medium

**Functional Requirements**
- `REQ-RDT-DASH-01`: Agregasi data (GROUP BY dinas dan status) dari tabel transaksi.
- `REQ-RDT-DASH-02`: Visualisasi persentase penyelesaian konfirmasi per dinas secara real-time (pertimbangkan caching di layer Node.js/API untuk query agregasi yang berat, supaya tidak dihit berulang oleh banyak dinas sekaligus).

### 3.5 Threaded Communication (Komentar Berulir)

**Priority:** High (naik dari Medium — sekarang jadi bagian inti halaman Dashboard-Detailing, bukan fitur tambahan terpisah, lihat REQ-RDT-NAV-03)

**Functional Requirements**
- `REQ-RDT-COMMENT-01`: Tabel Komentar berelasi dengan tabel Transaksi melalui Foreign Key.
- `REQ-RDT-COMMENT-02`: Logika parent-child agar komentar tampil terindentasi seperti forum.
- `REQ-RDT-COMMENT-03`: Sistem harus mendeteksi @mention (referensi ke user/role lain) dalam isi komentar dan mengirim **notifikasi** ke pengguna yang di-mention (mis. badge/counter notifikasi, bisa juga entry di tabel notifikasi baru). @mention **PURELY notifikasi** — tidak memicu perubahan status transaksi atau reassignment otomatis apapun (lihat klarifikasi di REQ-RDT-NAV-03). Format penulisan mention di UI (mis. `@nama` dengan autocomplete) menyusul, tapi minimal parsing teks `@[...]` harus terdeteksi.
  > **Diperjelas 3 Agu**: mention yang di-resolve ke akun beneran HARUS dirender sebagai
  > elemen yang nunjuk ke akun itu (mis. chip/link ber-style beda, bisa diklik lihat
  > profil singkat) — BUKAN cuma teks `@nama` polos tanpa keterhubungan visual/
  > fungsional ke akun aslinya. Kalau backend udah resolve mention ke `user_id` yang
  > valid, frontend WAJIB render itu sebagai elemen ter-link, bukan teks mentah.
  > **Diperluas 3 Agu ke SEMUA field notes/deskripsi**: sistem @mention (parsing +
  > notifikasi + rendering ter-link) harus jalan di SEMUA tempat yang nerima teks
  > bebas sebagai catatan/deskripsi — bukan cuma komentar thread biasa, tapi juga:
  > deskripsi penutup TAB (REQ-RDT-SAP-05), deskripsi/reply saat Confirm/Reject
  > (`confirmation.js`), dan "Catatan Reviewer" (REQ-RDT-NAV-04). Satu implementasi
  > @mention yang dipakai ulang di semua field ini, bukan ditulis beda-beda per
  > tempat.
  > **Bug privasi ditemukan 3 Agu**: satu pesan bisa nge-mention BANYAK dinas
  > sekaligus (mis. broadcast dari TJ yang nge-tag TA dan TMM di pesan yang sama).
  > Notifikasi HARUS tetap privat per akun — user TA TIDAK BOLEH bisa lihat bahwa
  > TMM juga dapet notifikasi dari pesan yang sama, walau keduanya di-mention di
  > pesan yang identik. Query/tampilan notifikasi HARUS di-scope ketat ke
  > `recipient_user_id = user yang sedang login`, jangan pernah expose daftar
  > penerima lain dari komentar/notifikasi yang sama.
  > **MASIH BOCOR per 4 Agu (dilaporkan ulang, ke-2 kalinya)**: bug ini SAMA
  > PERSIS dengan yang dilaporkan 3 Agu, BELUM diperbaiki. Ini prioritas tinggi
  > (kebocoran privasi antar dinas), bukan sekadar UX — audit SEMUA endpoint yang
  > mengembalikan data notifikasi/komentar, pastikan tidak ada satupun yang
  > mengembalikan daftar penerima lain selain user yang sedang login.
  >
  > **AKAR MASALAH DITEMUKAN & DIPERBAIKI 4 Agu**: bug sebelumnya (B1) SUDAH benar
  > men-scope QUERY notifikasi (`WHERE recipient_user_id = $1`) — itu bukan yang
  > bocor. Akar masalah sebenarnya ada di SISI PENULISAN: 6 tempat berbeda yang
  > membangun daftar penerima komentar (`index.js` fan-out deskripsi Repost per
  > pasangan, `confirmation.js`, `dashboard.js` komentar manual, `investigation.js`,
  > `shareCost.js`, `exportBatches.js`) semua resolve SEMUA `@mention` di teks
  > SECARA MENTAH lewat `resolveMentionedUserIds`, tanpa membatasi ke pasangan
  > (dinas_inisiasi, dinas_target) yang komentar itu SUNGGUH tertuju. Jadi satu
  > deskripsi broadcast "@TA @TMM" yang memicu komentar TERPISAH untuk pasangan
  > TJ→TA dan TJ→TMM membuat PIC TA ikut jadi recipient komentar TJ→TMM juga (dan
  > sebaliknya) — begitu PIC TA buka notifikasinya sendiri (query-nya sudah benar,
  > cuma nunjukin notifikasi MILIK dia), salah satu barisnya nunjukin pasangan
  > TJ→TMM, membocorkan bahwa TMM juga di-notify dari pesan yang sama.
  > Fix: `rules/mentionRules.js` dapat fungsi baru `filterMentionsToPair(userIds,
  > directory, allowedDinasCodes)` — hasil `resolveMentionedUserIds` di-saring dulu
  > supaya cuma user yang dinas-nya benar-benar bagian dari pasangan itu (atau role
  > TAB) yang jadi recipient, diterapkan di keenam tempat di atas. Diverifikasi:
  > `test/mentionRules.test.js` (4 test baru) + `npm test` (65/65 hijau) + live lewat
  > backend sungguhan (upload TJ dengan deskripsi broadcast "@TA @TMM" ke pasangan
  > yang sungguh berbeda — notifikasi PIC TA dan PIC TMM masing-masing HANYA
  > berisi pasangannya sendiri). 6 baris notifikasi bocor dari SEBELUM fix ini
  > (data dev/demo, ditemukan lewat audit yang sama) sudah dibersihkan
  > (`tools/cleanupLeakedNotifications.js`).
  >
  > **Temuan sampingan saat verifikasi**: `migrate.js` ternyata menjalankan ULANG
  > SEMUA file migrasi setiap kali backend start (bukan cuma yang belum pernah
  > jalan) — baru ketahuan sekarang karena migrasi 004's daftar status yang lebih
  > sempit (belum ada `SUPERSEDED`) gagal tervalidasi begitu data `SUPERSEDED`
  > sungguhan sudah ada (dari REQ-RDT-EXT-10) dan server di-restart. Diperbaiki
  > dengan tabel `rdt._migrations_applied` supaya tiap file migrasi cuma jalan
  > SEKALI selamanya, bukan tiap boot — lihat `migrate.js` dan
  > `tools/backfillMigrationsApplied.js` (dijalankan sekali untuk transisi DB dev
  > yang sudah ada).
- `REQ-RDT-COMMENT-04` **(baru 31 Jul)**: Mention `@TA` harus di-resolve sebagai mention ke **TAB** (bukan dicari sebagai dinas terpisah bernama "TA") — konsisten dengan REQ-RDT-AUTH-04 yang menyatakan TA sudah tergabung ke TAB. Tanpa alias ini, `@TA` tidak menotifikasi siapapun karena tidak ada directory entry dengan `dinas='TA'`.
  > **DIBATALKAN 31 Jul** — lihat REQ-RDT-AUTH-05: `TA` ternyata dinas mandiri dengan
  > PIC sendiri, alias ini SALAH dan sudah dihapus dari `mentionRules.js`. Baris ini
  > dipertahankan di dokumen sebagai jejak sejarah keputusan, BUKAN requirement aktif.

### 3.6 Audit Trail & Logging Aktivitas

**Priority:** High

**Functional Requirements**
- `REQ-RDT-AUDIT-01`: Sistem harus mencatat setiap aksi Approve/Reject ke tabel log dengan atribut minimal: `user_id` pelaku, `transaction_id` terkait, `status_sebelum`, `status_sesudah`, `timestamp`, `ip_address`.
- `REQ-RDT-AUDIT-02`: Sistem harus mencatat setiap kejadian rollback transaksi beserta kategori alasan kegagalannya ke tabel log yang sama.

### 3.7 Otorisasi Berbasis Fitur (Feature-Level Authorization)

**Priority:** High — bagian baru menyusul konfirmasi bahwa GMF sudah punya basis data pengguna.

**Functional Requirements**
- `REQ-RDT-AUTH-01`: Sistem harus memvalidasi identitas pengguna terhadap tabel pengguna/karyawan yang sudah dikelola tim IT (bukan tabel user baru), untuk menentukan apakah pengguna berhak membuka modul RDT sama sekali.
- `REQ-RDT-AUTH-02`: Sistem harus memetakan pengguna yang login ke dinas/entitas yang relevan (dinas asal), untuk menentukan baris transaksi apa saja yang boleh dia lihat/validasi (lihat REQ-RDT-LEDGER-01).
- `REQ-RDT-AUTH-03`: Role `TAB` harus dapat dibedakan dari PIC Dinas Lintas melalui atribut role/kelas pengguna yang sama-sama berasal dari tabel pengguna terpusat tersebut.

> **Open question — perlu dikonfirmasi ke tim IT**: nama tabel/skema pengguna yang sudah ada, kolom yang menandakan dinas & role, dan mekanisme mana yang dipakai untuk membaca identitas user yang sedang login (JWT claim, session lookup, atau API internal ke user service).

- `REQ-RDT-AUTH-04` **(koreksi 22 Jul terhadap implementasi saat ini; role `ADMIN_TAB` diganti nama jadi `TAB` per koreksi 24 Jul)**: Konfirmasi transaksi dengan `dinas_target = 'Corp'` HANYA boleh dilakukan oleh role `TAB`. Corp tetap tidak punya PIC dedicated (baris data `dinas_target='Corp'` tidak berubah), tapi yang berhak bertindak atas namanya cuma role `TAB`. Sudah diterapkan di `middleware/auth.js` (`requireDinasAccess`). **Klarifikasi 31 Jul**: kode/nilai dinas tetap `Corp` di database maupun dokumen ini — jangan direname jadi "TAB" di manapun, termasuk label yang ditampilkan ke user (tetap tampil "Corp"). Yang berubah cuma SIAPA yang berwenang bertindak (role TAB), bukan nama dinasnya.
- `REQ-RDT-AUTH-05` **(SUPERSEDED 24 Jul, lalu DIKOREKSI LAGI 31 Jul — baca urutan di bawah, jangan cuma baca versi terakhir)**:
  - *24 Jul*: role `SM_TA`/`GH_TA` dihapus, disatukan jadi `TAB` doang. Saat itu diasumsikan `TA` juga ikut lebur ke `TAB` (dianggap entitas yang sama).
  - *31 Jul, KOREKSI dari presentasi progress*: asumsi itu SALAH. **`TA` adalah dinas OPERASIONAL SENDIRI dengan PIC-nya sendiri** — user TA dan user TAB adalah DUA ORANG/ROLE BERBEDA, bukan sinonim. `dinas_target = 'TA'` harus diperlakukan PERSIS seperti dinas lain (TC, TJ, dst): masuk antrian konfirmasi milik PIC dinas TA sendiri, BUKAN dibundling ke antrian TAB.
  - Yang TETAP masuk ke TAB (bukan ke dinas manapun): **`Corp`** (REQ-RDT-AUTH-04) dan **`Ask TA`** (kategori investigasi, REQ-RDT-LEDGER-10 — ini beda dari dinas `TA`, jangan disamakan biarpun namanya mirip).
  - **Dampak ke kode yang PERLU DIBATALKAN**: `DINAS_TOKEN_ALIASES = { TA: 'TAB' }` di `mentionRules.js` (REQ-RDT-COMMENT-04, ditambahkan 31 Jul pagi) itu SEKARANG SALAH dan harus dihapus — `@TA` di komentar harus notify PIC dinas TA yang sungguhan, bukan TAB. `rdt.dinas` seed juga perlu entri `TA` sendiri (kalau belum ada) dengan PIC-nya sendiri di `employee-directory.seed.json`.
  - Setelah koreksi ini, role yang ada tetap cuma 2 (`PIC`, `TAB`) — yang berubah bukan jumlah role, tapi **dinas TA masuk kategori "punya PIC" seperti dinas biasa**, bukan kategori "TAB yang staffing" seperti Corp/Ask TA.

### 3.8 Struktur Navigasi (Sidebar) & Home Dashboard

**Priority:** High — ini keputusan struktur fondasi, bukan sekadar estetika.

> **UPDATE 22 Jul (Figma detail penuh + prototype)** — file:
> https://www.figma.com/design/ZLbcosQTNTZdWQRusRYH0R/budgeting-ui
> Section "UI" (node `42:234`) berisi seluruh layar dengan detail final: Login, Select
> Platform, Dashboard, Dashboard-Detailing (per pasangan dinas), Repost, Confirmation.
> Ini menggantikan draft wireframe kasar sebelumnya — detail di bawah mengacu langsung
> ke node Figma yang sudah dibangun, bukan wireframe placeholder lagi.

**Sidebar (6 item navigasi, urut sesuai Figma node `35:337`–`35:357`):**
1. **Dashboard** — halaman utama (lihat REQ-RDT-NAV-02 di bawah)
2. **Repost** — alur upload (lihat REQ-RDT-NAV-04)
3. **Confirming** — alur konfirmasi (lihat REQ-RDT-NAV-05)
4. **Need Approval** — **BARU, belum ada desain isinya di Figma sama sekali**, baru
   nav item kosong. Ini kemungkinan tempat alur approval SM/GH (`export_batches`,
   sudah ada backend-nya di `routes/exportBatches.js`) — **perlu dikonfirmasi ke
   pemilik proyek**, jangan diasumsikan strukturnya.
5. **Guidance Application**, **Feedback Application** — sama, nav item kosong tanpa
   desain isi. Kemungkinan besar prioritas rendah (halaman bantuan/feedback statis).

> **Koreksi 23 Jul**: sebelumnya dokumen ini menyebut 8 item termasuk "DT - TC",
> "DT - TJ", "DT - TN" sebagai item sidebar tersendiri. Itu **salah baca** dari draf
> Figma — TC/TJ/TN di situ cuma CONTOH ILUSTRASI untuk nunjukkin gimana halaman
> Dashboard-Detailing keliatan kalau ada dinas spesifik yang di-mention & lagi ada
> percakapan (thread komentar) terkait repost/confirmation, BUKAN item sidebar
> permanen yang harus selalu ada. Drill-down ke Dashboard-Detailing tetap terjadi
> lewat klik kartu di panel kiri Dashboard (REQ-RDT-NAV-02), bukan lewat sidebar.

**Functional Requirements**
- `REQ-RDT-NAV-01`: Sidebar navigasi tampil persisten di semua halaman RDT, berisi
  logo GMF (asset: `src/frontend/rdt/assets/gmf-logo.png`, sudah ada) di atas, 6 item
  navigasi di atas, dan badge profil user pojok kanan atas (avatar + nama). Badge ini
  harus BISA DIKLIK untuk memunculkan opsi **Logout** (lihat REQ-RDT-NAV-08).
- `REQ-RDT-NAV-02` (halaman **Dashboard**, node `1:2` — nama frame Figma sekarang
  "Dashboard-Confirming-RDT", konfirmasi bahwa **default sub-view saat klik "Dashboard"
  di sidebar adalah "Need to Confirm", BUKAN "Own Repost"** — lihat REQ-RDT-NAV-02a):
  terbagi 2 sub-view yang bisa di-switch (bukan digabung satu layar penuh):
  - **"Need to Confirm"** (default): daftar pasangan dinas yang MEMINTA user
    mengonfirmasi (dinas lain → user). Tiap pasangan ditampilkan sebagai kartu berisi:
    donut/circular chart persentase confirmed (mis. "75.0%"), jumlah komentar
    ("10 reply"), dan badge angka (kemungkinan jumlah transaksi — perlu dikonfirmasi).
    Klik kartu → drill-down ke REQ-RDT-NAV-03, terfilter ke pasangan dinas itu.
    Section kosong jika user tidak perlu konfirmasi di dinas manapun.
  - **"Own Repost"**: sub-view kedua, visualisasi serupa tapi untuk transaksi yang
    DIAJUKAN oleh dinas user sendiri ke dinas lain. Section kosong jika user tidak
    mengajukan repost ke dinas manapun.
  - **Diperjelas 1 Agu**: kartu di KEDUA sub-view ("Need to Confirm" maupun "Own
    Repost") harus menampilkan **state label** (REQ-RDT-SAP-07: "Waiting for
    confirmation [Role]" / "Waiting to repost" / "Reposted with subdoc [nomor]")
    — status repost bukan cuma keliatan di Need Approval/Riwayat, tapi juga di
    Dashboard, sesuai desain terbaru (lihat referensi Figma di section 3.9).
- `REQ-RDT-NAV-02a` **(baru 27 Jul, keputusan produk)**: Karena "Need to Confirm" itu
  action item (ada keputusan yang ditunggu) sementara "Own Repost" murni informasional
  (monitoring, tidak perlu tindakan), keduanya TIDAK dianggap berbobot sama:
  1. Sub-view **default** saat sidebar item "Dashboard" diklik harus **"Need to
     Confirm"**, bukan "Own Repost" — supaya hal yang butuh tindakan lebih dulu
     ketemu mata, bukan ketiban urutan tab.
  2. Sidebar HARUS menampilkan **badge counter angka** (jumlah pasangan dinas yang
     punya transaksi PENDING butuh konfirmasi dari user) yang terlihat dari HALAMAN
     MANAPUN, bukan cuma saat sedang membuka Dashboard — taruh di item sidebar
     "Dashboard" itu sendiri (dan/atau badge terpisah kalau nanti ada sub-nav
     eksplisit). Ini prioritas lebih tinggi dari sekadar urutan tab/sub-view, karena
     baru inilah yang mencegah PIC lupa ada yang perlu dikonfirmasi walau mereka lagi
     buka halaman lain sama sekali (Repost, Confirmation dinas lain, dst).
- `REQ-RDT-NAV-03` (halaman **Dashboard-Detailing**, node `35:209` generik / `36:370`
  & `39:143` contoh terisi untuk TC & TJ): drill-down dari satu kartu di panel kiri
  Dashboard. Menampilkan ulang donut chart + reply count untuk pasangan dinas itu, DAN
  **thread komentar penuh di bawahnya** (REQ-RDT-COMMENT terintegrasi langsung di sini,
  bukan cuma modal terpisah) — tiap komentar: avatar, nama pengirim, isi pesan dengan
  @mention ke user/role lain. Contoh isi dari Figma menunjukkan pola nyata: inisiator
  nge-tag beberapa PIC sekaligus minta konfirmasi, PIC target balas konfirmasi sebagian
  dan me-redirect sisanya ke PIC dinas lain via @mention ("...namun beberapa item tidak
  seharusnya kami miliki, seharusnya menjadi milik @[PIC TN]"). Contoh kedua (TJ)
  menunjukkan kasus selesai 100% tanpa redirect. **Klarifikasi 22 Jul (dikonfirmasi
  pemilik proyek)**: @mention di komentar ini PURELY notifikasi (memberi tahu orang
  yang di-mention bahwa mereka disebut) — TIDAK memicu aksi sistem apapun (tidak
  otomatis reassign/redirect transaksi). Redirect transaksi yang sebenarnya tetap
  cuma lewat mekanisme terstruktur `redirect_to`/reassignment yang sudah ada di
  `routes/confirmation.js` & `routes/reassignment.js`. Lihat REQ-RDT-COMMENT-03 untuk
  requirement notifikasi mention.
  > **Masih salah per 31 Jul (temuan presentasi progress)**: backend (`fetchReassignChainMap`)
  > sudah benar melacak FULL chain redirect buat keperluan agregasi/grouping kartu
  > dashboard, TAPI **visual panah/breadcrumb di halaman ini masih nunjukin cuma titik
  > awal dan akhir** (mis. `TJ → TL`), bukan chain lengkapnya (`TJ → TC → TL` kalau
  > TC sempet reject-redirect ke TL). Data chain-nya SUDAH ADA di backend (audit_log
  > REASSIGN/REJECT_REDIRECT) — yang belum ada itu elemen UI yang nge-render
  > breadcrumb itu jadi rangkaian penuh, bukan cuma dinas_inisiasi+dinas_target.
  > Perbaiki tampilan header halaman ini (dan di manapun lagi "arrow" pasangan dinas
  > ditampilkan, mis. kartu Dashboard) supaya nunjukin SELURUH rangkaian dinas yang
  > pernah disinggahi transaksi itu, bukan cuma titik awal-akhir.
  > **MASIH BELUM DIBENERIN per 3 Agu** — ini requirement yang SAMA, ditegaskan
  > ulang karena masih belum kelar sejak 31 Jul. Verifikasi eksplisit setelah
  > implementasi: tampilkan skrinsyut/contoh nyata kasus reassign 2+ hop, bukan
  > cuma laporan "sudah dikerjakan" tanpa bukti visual.
  > **Diperjelas 3 Agu, ditemukan dari perbandingan langsung**: halaman
  > `/rdt/dashboard/detail/:from/:target` (Dashboard-Detailing) SUDAH benar
  > menampilkan detail state termasuk reassign, TAPI level detail/visualisasi yang
  > SAMA hilang dari dua tempat lain yang menampilkan pasangan dinas yang SAMA:
  > halaman Dashboard utama (`/rdt/dashboard?sub=need`) dan halaman Confirm
  > (`/rdt/confirm?from=...&target=...`). Klik kartu di Dashboard utama HARUS
  > mengarah LANGSUNG ke `/rdt/dashboard/detail/:from/:target` (bukan ke halaman
  > lain yang lebih sederhana) — konsistensi visualisasi status di ketiga tempat
  > ini penting, bukan cuma di satu halaman detail doang.
  > **REVISI 4 Agu (logic klik kartu diperjelas)**: bukan SELALU ke
  > `/rdt/dashboard/detail/...` — tergantung status: kalau pasangan itu MASIH ADA
  > yang perlu dikonfirmasi (PENDING), klik kartu langsung ke
  > `/rdt/confirm?from=X&target=Y` (halaman aksi). Kalau pasangan itu SUDAH BERES
  > semua (gak ada PENDING tersisa), BARU klik kartu ke
  > `/rdt/dashboard/detail/X/Y` (halaman ringkasan/riwayat). Intinya: arahkan ke
  > halaman yang sesuai AKSI yang masih perlu dilakukan, bukan satu tujuan tetap.
  > **IMPLEMENTED 4 Agu**: `home.component.ts`'s `onCardClick` sekarang cek `d.open`
  > (jumlah PENDING pasangan itu, sudah ada di response backend, tinggal dipakai)
  > — `> 0` ke `goToConfirmFrom` (Confirm), `0` ke `goToDetail` (Dashboard-
  > Detailing). Diverifikasi live: kartu TJ→TA (0.0%, PENDING tersisa) klik ->
  > `/rdt/confirm?from=TJ&target=TA`; kartu TJ→TZ (100.0%, tidak ada PENDING) klik
  > -> `/rdt/dashboard/detail/TJ/TZ`.
  > **MASIH BELUM DIBENERIN per 4 Agu (dilaporkan ulang)**: visualisasi progress
  > yang di halaman `/rdt/dashboard/detail/:from/:target` (termasuk kasus belum
  > 100%) MASIH BELUM tersinkron ke `/rdt/dashboard?sub=need` — tanggung jawab ini
  > BELUM SELESAI meski sudah diminta beberapa kali sejak 31 Jul.
  > **Diperjelas 4 Agu (perlu konfirmasi ke pemilik proyek, JANGAN ditebak)**:
  > soal progress transaksi yang di-redirect/reassign — pemilik proyek minta
  > progress dari hasil redirect/reassign itu "nambah di samping progress
  > asli/assign pertama", tapi mekanisme persisnya (apakah donut utama harus
  > menghitung SEMUA hop sebagai satu kesatuan progress, atau ada indikator
  > terpisah di samping donut utama yang nunjukin progress tiap hop) BELUM
  > jelas dari kalimat aslinya — coding agent harus tanya balik ke pemilik
  > proyek dengan menunjukkan 2-3 opsi visual konkret sebelum implementasi,
  > bukan menebak salah satu.
  > **IMPLEMENTED 5 Agu — desain final hasil beberapa putaran opsi visual dengan
  > pemilik proyek**: donut utama TETAP satu progress gabungan (semua hop, tidak
  > berubah). Ditambah badge kecil collapsed-by-default di kartu (mis. `→TC 5/12`),
  > MUNCUL HANYA kalau `chain` genuinely multi-hop (lebih dari 2 titik — yang
  > berarti SEMUA transaksi di kartu itu setuju pada jalur yang identik, lihat
  > `chainConsistent` di `dashboard.js`). Klik badge -> expand KE SAMPING (bukan ke
  > bawah, permintaan eksplisit), garis pemisah vertikal, isi = mini progress bar
  > per-hop. Setiap hop SELAIN hop terakhir otomatis 100% (N/N) — chain-consistency
  > sendiri sudah membuktikan semua transaksi di kartu itu melewati & meninggalkan
  > hop itu; hop TERAKHIR pakai angka `resolved`/`total` yang sama dengan donut
  > utama, bukan hitungan baru. Konsekuensinya: nol perubahan backend, murni
  > frontend (`home.component.ts`'s `chainHops()`/`toggleChainExpand()`).
  > Diverifikasi live dengan skenario nyata (redirect 12 transaksi TJ→TA ke TC
  > lewat API confirmation sungguhan, confirm 5 di antaranya) — badge `→TC 5/12`,
  > expand nunjukin `TJ→TA 12/12` dan `TA→TC 5/12`.
- `REQ-RDT-NAV-04` (halaman **Repost**, node `20:499`): 2 kolom.
  - **Kolom kiri**: "Upload" (drop file/select from device) di atas, "Review" ("Review
    Detailing Transaction Before Upload") di bawah — review detail transaksi hasil
    parse SEBELUM benar-benar diunggah ke staging.
  - **Kolom kanan, panel persisten "Confirm to Repost"**: tombol **Confirm** dan
    **Cancel** — aksi final setelah review (Cancel = batalkan, tidak menyimpan apapun).
    Ini menggantikan tombol tunggal "Simpan ke staging" di `ui-demo.html` versi
    sebelumnya — perlu ada opsi batal yang eksplisit.
  - **Kolom tabel preview/Review (baru 31 Jul, feedback presentasi progress; diperjelas
    1 Agu)**: urutan kolom yang diminta — **Sub Group** di paling kiri, lalu kolom data
    yang sudah ada, **Remark** di kanan, dan **kolom baru "Catatan editable oleh
    reviewer"** di paling kanan (teks bebas yang bisa diisi TAB/reviewer saat masih di
    tahap review, sebelum upload final — belum jelas disimpan ke kolom transaksi mana,
    kemungkinan field baru di `rdt.transactions` atau disimpan terpisah; tanya pemilik
    proyek kalau mau implementasi persisensinya, jangan asumsikan).
    - **"Sub Group" diperjelas 1 Agu**: ini BUKAN field turunan/hitungan — itu kolom
      **B** yang benar-benar ada di file DT asli yang diupload. Verifikasi posisi
      persisnya terhadap file contoh yang ada (`contoh_input/`) sebelum implementasi
      — ingat temuan 3.1.2 bahwa "Group"/"Sub Group" muncul di POSISI BERBEDA antar
      dinas (TJ-R1 taruh di depan Account, TM taruh di tengah setelah Acc.Text) —
      jangan asumsikan kolom B selalu "Sub Group" di SEMUA dinas, cross-check dulu.
    - **Cakupan kolom preview diperluas 1 Agu, DITEGASKAN LAGI 3 Agu**: tabel
      preview/Review ini harus menampilkan **SEMUA kolom yang sama seperti yang
      benar-benar ikut ter-repost** (bukan subset yang disederhanakan) — kalau nanti
      kolom kontrak berubah/nambah, preview ini ikut nambah juga, jangan di-hardcode
      terpisah dari sumber kolom yang dipakai proses repost sebenarnya. **Ini berlaku
      di SEMUA jenis fitur preview di seluruh sistem** (bukan cuma Review sebelum
      upload Repost) — termasuk transparansi Need Approval, drill-down Dashboard-
      Detailing, dan preview manapun lagi yang nampilin baris DT.
    - **Bug ditemukan 3 Agu**: kolom Sub Group MASIH BELUM MUNCUL di preview,
      padahal ada di file Excel-nya. Verifikasi kenapa — apakah salah posisi kolom
      (lihat catatan di atas soal posisi beda-beda per dinas), atau kolomnya kelewat
      di-map di parser/frontend. **Petunjuk tambahan 3 Agu**: kolom Sub Group
      TERNYATA SUDAH MUNCUL dengan benar di halaman "Wait to Repost"/"Confirm
      Reposted" milik TAB — artinya datanya BENAR ada & ke-parse, bug-nya spesifik
      di komponen preview Repost doang (kemungkinan kolom itu di-hardcode/di-skip
      di komponen frontend preview, bukan masalah parser backend). Bandingkan kedua
      komponen itu buat nemuin bedanya.
    - **"Catatan Reviewer" (baru 3 Agu)**: kolom ini HARUS **fixed di tempat, TIDAK
      scrollable** — sekarang keliatannya jadi kotak scroll terpisah, harusnya
      langsung kebaca penuh tanpa perlu scroll di dalam sel/kolom itu.
      **MASIH SCROLLABLE per 4 Agu (dilaporkan ulang, ke-3 kalinya)** — pin/fix
      kolom ini (`position: sticky` atau setara), verifikasi dengan screenshot
      sebelum lapor selesai.
- `REQ-RDT-NAV-05` (halaman **Confirmation**, node `20:712`): tabel `list-yang-harus-
  dikonfirmasi` dengan header "[Dinas Lain] → [User]" (menunjukkan konteks pasangan
  dinas yang sedang dikonfirmasi) dan tombol **Submit** di pojok kanan atas. Tabel:
  7 kolom data (placeholder di Figma, isi sebenarnya = kolom kontrak transaksi seperti
  account/nominal/remark dst.), + kolom aksi per baris + "Select All" di header kolom aksi.
  > **Evolusi 23 Jul (implementasi lebih sederhana dari draf awal)**: bukan toggle
  > Confirm/Reject terpisah di atas tabel, tapi **satu checkbox per baris** yang
  > langsung JADI keputusannya — dicentang = Confirm, tidak dicentang = Reject.
  > "Select All" mencentang semua baris (lintas halaman pagination, bukan cuma
  > halaman yang lagi tampil). Submit menampilkan dialog konfirmasi eksplisit yang
  > merinci jumlah baris ter-Confirm vs ter-Reject sebelum eksekusi — tidak ada
  > status "belum diputuskan/skip", setiap baris yang tampil pasti ke-submit sebagai
  > salah satu dari keduanya. Setiap baris Reject juga punya dropdown opsional
  > "redirect ke dinas lain" (lihat REQ-RDT-LEDGER-07 jalur a).
  > **Tata letak baris declined/reassigned (baru 3 Agu)**: baris yang statusnya
  > DECLINED/sedang direassign TETAP ditampilkan di halaman ini (sesuai desain),
  > TAPI JANGAN ditumpuk sebagai list tambahan di BAWAH tabel utama yang perlu
  > dikonfirmasi — taruh di **tab/sheet terpisah** (mirip tab sheet Excel di bagian
  > bawah workbook), MUNCUL HANYA KALAU ADA datanya (kalau kosong, tab ini gak usah
  > dirender sama sekali, jangan nampilin tab kosong).
  > **Rename "reply" jadi "comment" + spacing (baru 3 Agu)**: istilah "reply"/"N reply"
  > yang muncul di kartu (Dashboard, Confirmation, dst) diganti jadi "comment"/"N
  > comment". Badge jumlah comment dan tag status (state label REQ-RDT-SAP-07) yang
  > sekarang nempel dempet-dempetan di kartu yang sama harus dikasih jarak (gap) yang
  > jelas — lihat REQ-RDT-UI-04.
- `REQ-RDT-NAV-06`: Struktur ini berlaku untuk `ui-demo.html` MAUPUN source Angular di
  `src/frontend/rdt/` — keduanya harus tetap sinkron secara struktur navigasi, sesuai
  aturan sinkronisasi di `src/README.md`. Modul Angular yang sudah ada (`home/`,
  `confirm/`, `need-approval/`, `pages/repost-budgeting/`) kemungkinan sudah dipetakan
  sebagian ke struktur ini — cek dulu sebelum bikin struktur baru dari nol.
- `REQ-RDT-NAV-07` **(baru 22 Jul, DIREVISI 5 Agu)**: Tabel besar (Review di halaman
  Repost, tabel di halaman Confirmation, dan SEMUA fitur lain yang menampilkan DT)
  menggunakan pagination pola "Google-style": maksimum **50 baris per halaman**
  (direvisi dari 100), font tabel dikecilkan sedikit dari sekarang. Kontrol
  Previous/Next; nomor halaman yang tampil maksimum **5 angka sekaligus**; kalau
  total halaman lebih dari yang muat, tampilkan `...` di ujung yang terpotong
  (awal dan/atau akhir) — klik nomor halaman manapun yang terlihat untuk loncat
  langsung ke situ, `...` tidak perlu diklik (cukup indikator ada halaman lain di
  luar rentang, nomor di sekitar halaman aktif yang bergeser saat navigasi).
  Komponen ini harus reusable (dipakai di SEMUA tabel DT, bukan diimplementasi
  ulang per halaman).
- `REQ-RDT-NAV-09` **(baru 31 Jul, filter multi-value ala SAP)**: Setiap tampilan yang
  menunjukkan data transaksi/DT (Repost Review, Confirmation, Dashboard-Detailing,
  transparansi Need Approval, Riwayat Repost TAB/Dinas, antrian Investigation, dst)
  harus punya opsi **filter multi-value dengan cara paste**, terinspirasi pola SAP:
  pengguna paste banyak nilai sekaligus (satu nilai per baris, dari copy kolom Excel
  misalnya) ke kotak filter untuk satu kolom tertentu (mis. Account, Remark, Ref.
  Doc.) — tabel langsung terfilter ke baris yang nilainya COCOK SALAH SATU dari
  daftar yang di-paste (OR di antara nilai yang di-paste, bukan AND). Harus jadi
  **komponen reusable** (satu implementasi dipakai di semua tabel di atas, bukan
  ditulis ulang tiap halaman) — pola yang sama seperti komponen pagination di
  REQ-RDT-NAV-07. Parsing paste: pisahkan per baris (newline) DAN per koma, trim
  whitespace tiap nilai, hilangkan duplikat.
  > **Diperluas 1 Agu**: filter ini harus tersedia di **SEMUA kolom** tabel, bukan
  > cuma satu kolom tertentu (mis. Account doang) — tiap kolom tabel punya kotak
  > filter multi-value sendiri, dan kalau lebih dari satu kolom di-filter sekaligus,
  > gabungannya AND antar kolom (baris harus cocok filter SEMUA kolom yang aktif),
  > sementara di DALAM satu kolom tetap OR (cocok salah satu nilai yang di-paste).
- `REQ-RDT-NAV-08` **(baru 23 Jul)**: Sistem harus punya halaman **Login** (username +
  password) dan **Select Platform** sesuai draf Figma awal (node `40:95`/`40:96`),
  MENGGANTIKAN dropdown "Login sebagai" yang sekarang cuma simulasi. Kredensial
  bersifat **synthetic/demo** (bukan integrasi tabel karyawan IT yang sebenarnya —
  itu masih open question di REQ-RDT-AUTH-01), tapi harus berupa username+password
  sungguhan (server memverifikasi password, bukan sekadar pilih dari daftar) supaya
  pengalaman pengujian mendekati produk final. Setiap identitas di
  `employee-directory.seed.json` (semua PIC 20 dinas + TAB; role SM_TA/GH_TA dihapus 24 Jul)
  harus punya kredensial. Badge user (REQ-RDT-NAV-01) yang diklik memunculkan opsi
  **Logout** yang menghapus sesi dan kembali ke halaman Login.
- `REQ-RDT-NAV-10` **(baru 31 Jul, rename label tampilan + beberapa id kode terkait,
  feedback presentasi progress)**: Label yang ditampilkan ke user berubah nama
  (kode/route internal ikut menyesuaikan SEPERLUNYA, bukan rename total semua
  identifier internal):

  **Untuk semua dinas (PIC):**
  | Label lama | Label baru |
  |---|---|
  | Own Repost (sub-view Dashboard) | Report Submission / Submission Status |
  | Repost (nav item) | Upload Detail Transaction |
  | Confirmation (nav item) | Detail Confirmation |
  | Riwayat Repost (dinas) | Repost History |

  > **Perlu diklarifikasi ke pemilik proyek** (jangan ditebak): catatan aslinya
  > bilang *"Need to confirm =/= status repost Confirmation Status"* — kemungkinan
  > maksudnya ada 2 konsep terpisah yang jangan ketuker: (a) sub-view "Need to
  > Confirm" di Dashboard tetap namanya itu, TIDAK direname, DAN (b) ada konsep baru
  > terpisah bernama "Confirmation Status" (mungkin state label REQ-RDT-SAP-07?).
  > Tapi ini tebakan — tanya ulang ke pemilik proyek sebelum coding agent
  > mengasumsikan salah satu.

  **Khusus tampilan role TAB:**
  | Label lama | Label baru |
  |---|---|
  | Need to Confirm (dashboard TAB) | Need Identification |
  | Repost Every PIC | Summary Progress All Dinas |
  | Repost (nav item, versi TAB) | **Dihapus** — TAB tidak originate repost sendiri (konsisten dengan catatan existing di `dashboard.js`) |
  | Confirmation (nav item, versi TAB) | Need Identification, dengan sub-item **Corp** dan **TAB** |
  | Need Approval | Wait to Repost |

  > **TERJAWAB 1 Agu**: bukan duplikasi tak sengaja — dikonfirmasi "Need to Confirm
  > (TAB)" dan "Confirmation (TAB)" memang DISATUKAN jadi SATU nav item bernama
  > **"Need Identification"**, dengan sub-item **Corp** dan **TAB**. Jadi nav TAB
  > yang tadinya punya "Need to Confirm" + "Confirmation" terpisah sekarang jadi
  > SATU item "Need Identification" saja untuk keduanya.
  > **Lokasi fitur Share-Cost (section 3.10)**: tempatnya di sidebar ini juga, di
  > bawah **"Need Identification"** — konsisten karena sama-sama urusan TAB soal
  > disambiguasi kepemilikan dinas.
  > **Desain dashboard "Need Identification" (baru 3 Agu)**: tampilannya mengikuti
  > pola visual/analitikal yang SAMA seperti "Report Submission / Submission Status"
  > milik dinas-dinas (lihat referensi Figma `Dashboard-SubmissionStatus-RDT` id
  > `78:242` di section 3.9) — bukan desain bespoke terpisah. Reuse komponen/pola
  > yang sama, cukup data-nya di-scope ke urusan TAB (Corp, TA, investigasi).

### 3.9 Pedoman Visual (Design Tokens)

**Priority:** Medium — konsistensi visual, bukan business logic, tapi berlaku ke SEMUA
halaman jadi worth didokumentasikan di satu tempat drpd diputuskan ulang tiap komponen.

- `REQ-RDT-UI-01` **(baru 27 Jul)**: Semua ikon di sidebar dan tombol aksi menggunakan
  **Lucide** (lucide-react untuk Angular via lucide-angular, atau lucide static SVG
  untuk `ui-demo.html`) — bukan kotak warna polos placeholder yang ada sekarang di
  draf Figma, dan bukan emoji. Satu icon set konsisten, jangan campur sumber lain.
- `REQ-RDT-UI-02` **(baru 27 Jul, override draf Figma)**: Border-radius elemen (card,
  tombol, input) **moderat, TIDAK terlalu bulat** — draf Figma sekarang pakai radius
  16px–32px untuk card besar, itu di luar preferensi pemilik proyek yang eksplisit
  minta *"jangan round banget"*. Pedoman pengganti: **6–10px** untuk card/tombol/input
  pada umumnya, maksimum ~12px untuk container besar (bukan 32px). Kalau draf Figma
  berikutnya masih pakai radius besar, ikuti pedoman angka di sini, bukan literal
  pixel value di file Figma — kecuali pemilik proyek eksplisit bilang sudah berubah
  preferensi.
- Warna aksen di draf Figma terbaru: `#006298` (biru GMF versi terbaru) — sedikit
  beda dari `#0b5ba7` yang dipakai duluan di `ui-demo.html`/`pagination.component`.
  **Perlu diselaraskan** ke satu nilai (rekomendasi: pakai `#006298` karena itu yang
  ada di aset logo & Figma terbaru, anggap versi lama sebagai draf awal yang belum
  final) — jangan biarkan dua nilai biru berbeda nyampur di halaman yang beda.
- `REQ-RDT-UI-03` **(baru 1 Agu, DIPERLUAS 3 Agu)**: Semua item visual di SEMUA jenis
  dashboard (card, badge, tag status, kotak KPI, dst) TIDAK memakai drop shadow —
  pakai **outline/border** sebagai penanda visual sebagai gantinya. Sebelumnya cuma
  berlaku ke tombol putih, sekarang berlaku ke seluruh elemen visual dashboard.
- `REQ-RDT-UI-04` **(baru 1 Agu)**: Beberapa tombol/elemen aksi yang sekarang
  berdempetan (jarak antar-elemen terlalu rapat) perlu diberi jarak (margin/gap)
  yang lebih lega — audit halaman yang paling padat elemennya (Confirmation,
  Need Approval, Investigation) dan tambah spacing yang konsisten, bukan cuma
  1-2 tombol yang dibenerin.
- `REQ-RDT-UI-05` **(baru 4 Agu, ROLLBACK lalu DIBATALKAN LAGI 4 Agu — baca urutan,
  jangan cuma versi terakhir)**:
  - *Versi pagi 4 Agu*: pemilik proyek minta rollback ke versi SEBELUM referensi
    Figma `78:242`/`78:243` karena dinilai "terlalu maksa dan acak-acakan".
  - *Revisi sore 4 Agu*: setelah rollback dieksekusi, ternyata hasilnya KETERLALUAN
    mundur (balik ke versi paling basic/awal, bukan yang dimaksud) — pemilik proyek
    sekarang MINTA BALIK ke arah desain Figma (`78:242`/`78:243`), yang penting
    **colorful/kaya visual** kayak referensi Figma itu, BUKAN desain polos.
  - **Status per revisi ini**: implementasikan ULANG desain berdasarkan
    `get_design_context` fresh ke node `78:242`/`78:243` — JANGAN pakai hasil
    implementasi sebelumnya sebagai basis (kemungkinan itu yang bikin kesan
    "maksa/acak-acakan", entah karena eksekusinya kurang rapi atau alasan lain
    yang masih dikonfirmasi ulang ke pemilik proyek). Tunggu klarifikasi lanjutan
    sebelum full commit ke arah ini kalau ada instruksi susulan.
  - **DIPERJELAS LAGI 4 Agu, malam — klarifikasi penting soal versi**: ternyata ada
    **3 versi historis**, bukan 2: (1) versi basic/awal ("baheula", yang aktif
    SEKARANG setelah rollback pagi), (2) iterasi PERTAMA desain ala-Figma
    ("terbaru.1") — **INI YANG DIMAKSUD pemilik proyek**, dan (3) iterasi KEDUA/
    lanjutan dari (2) ("terbaru.2") yang dinilai "maksa dan acak-acakan" dan sudah
    di-rollback. Instruksi "implementasikan ulang dari Figma fresh" TIDAK CUKUP
    dan BERISIKO — itu bisa menghasilkan sesuatu yang beda lagi dari terbaru.1
    maupun terbaru.2. **Yang benar-benar dibutuhkan**: telusuri **git history**
    (`git log`) untuk file-file komponen dashboard/need-approval Angular, temukan
    commit yang berkorespondensi ke terbaru.1 (versi SEBELUM iterasi kedua/
    "acak-acakan" itu terjadi), TUNJUKKAN ke pemilik proyek ringkasan/screenshot
    tiap commit kandidat supaya bisa dikonfirmasi PERSIS yang mana, baru revert ke
    situ — JANGAN menebak atau nge-generate ulang dari deskripsi.
  - **KEPUTUSAN FINAL 4 Agu, malam**: setelah lihat screenshot kandidat, pemilik
    proyek MEMILIH **commit `3c2d8f5`** (dilabeli "Kandidat iterasi 2" oleh coding
    agent, tapi INI YANG DIPAKAI — abaikan penomoran iterasi sebelumnya, ini
    keputusan final berdasarkan lihat langsung) sebagai basis dashboard TAB
    ("Summary Progress All Dinas"): KPI card row + tabel per-dinas dengan progress
    bar, gaya bersih/simpel.
  - **Tambahan yang diminta digabung**: khusus untuk kartu yang melibatkan
    reassign/redirect (chain 2+ hop), gabungkan pola **"Rincian per-hop"** dari
    contoh terpisah yang ditunjukkan pemilik proyek — donut/persentase utama di
    kiri, panel di kanan berisi breakdown progress BAR PER HOP individual (mis.
    "TJ → TA: 12/12", "TA → TC: 5/12"), plus chip kecil yang bisa diklik buat
    lihat detail hop tertentu (mis. "→TC 5/12"). Ini SEKALIGUS jadi penyelesaian
    REQ-RDT-NAV-03 (chain arrow yang berkali-kali dilaporkan belum benar) —
    breakdown per-hop yang eksplisit ini lebih informatif daripada sekadar teks
    panah "TJ→TA→TC".
  - **Diperjelas 5 Agu**: "expand"/detail dari kartu manapun yang melibatkan chain
    harus menampilkan rincian dari SEMUA sisi/dinas yang terlibat di chain itu
    (bukan cuma dari sudut pandang dinas pengaju awal) — simetris antar hop.
  - **Coding agent DIMINTA IKUT berkontribusi ide** soal cara paling rapi
    menggabungkan dua pola ini (kapan panel per-hop muncul/collapse, bagaimana
    layout menyesuaikan kalau chain-nya panjang, dst) — bukan cuma eksekusi
    instruksi literal, tapi juga usulkan penyempurnaan kalau ada yang menurutnya
    lebih baik, sebelum implementasi final.
- `REQ-RDT-UI-06` **(baru 4 Agu, DIREVISI 5 Agu — lihat juga versi lanjutan di
  bawah)**: Sidebar navigasi HARUS **fixed/pinned di posisinya, TIDAK scrollable**.
  Lebar sidebar juga dikecilkan sedikit dari yang sekarang (terlalu lebar).
  > **DIPERLUAS 5 Agu (referensi Dribbble shot "Sidebar navigation menu bar
  > expansion animation")**: bukan cuma dikecilkan statis — pola yang diminta
  > kemungkinan besar **collapsed-by-default** (cuma ikon, sempit ~60px) yang
  > **expand otomatis saat di-hover/klik** jadi lebar penuh dengan teks label
  > (pola umum: Notion, Linear, VS Code). Ini SEKALIGUS menjawab permintaan
  > "sidebar dikecilkan" di atas — defaultnya jauh lebih sempit. **Catatan**:
  > pemilik proyek kasih link Dribbble sebagai referensi visual
  > (`dribbble.com/shots/26211061`) yang TIDAK bisa diakses lewat tool
  > browsing biasa (perlu render JS) — coding agent WAJIB verifikasi detail
  > animasi/timing persis dari link itu sendiri (buka langsung di browser),
  > JANGAN cuma mengandalkan deskripsi umum di atas.
- `REQ-RDT-UI-09` **(baru 5 Agu)**: Banyak elemen dashboard yang sekarang tidak
  simetris (ukuran/spacing beda-beda antar kartu yang seharusnya sejenis) — audit
  dan samakan.

> **Eksperimen perbandingan 5 Agu (BUKAN requirement, catatan proses)**: pemilik
> proyek minta dicoba implementasi FRESH dari Figma node `0-1` dan `78-243` di
> tempat TERPISAH (branch/route terpisah, JANGAN timpa dashboard aktif langsung)
> untuk dibandingin side-by-side dengan versi sekarang — pemilik proyek merasa
> implementasi PERTAMA kali dulu "bagus banget". Kalau hasil perbandingan
> menunjukkan versi baru lebih rapi, BARU di-apply ke dashboard aktif dengan
> persetujuan eksplisit. Ini murni proses kerja, bukan perubahan spesifikasi —
> REQ-RDT-UI-05 (keputusan final 3c2d8f5 + panel per-hop) tetap jadi acuan resmi
> sampai ada keputusan baru dari perbandingan ini.

### 3.11 Frozen Column di Tabel Confirmation (baru 5 Agu)

Saat konfirmasi (halaman Detail Confirmation), tabel menampilkan semua ~53 kolom
kontrak (REQ-RDT-NAV-04). Kolom **"Notes"**, **"Jika Reject" (dropdown redirect)**,
dan **checkbox "Select"** HARUS **sticky/frozen secara horizontal** (`position:
sticky`), supaya tetap terlihat & bisa diklik tanpa perlu scroll kiri-kanan
sepanjang 53 kolom data. Pola ini setara "freeze panes" di Excel — kolom aksi
selalu di posisi tetap (kiri atau kanan tabel, pilih yang lebih natural secara UX),
kolom data yang scroll di antaranya.
- `REQ-RDT-UI-07` **(baru 4 Agu, date/period picker)**: Komponen pemilihan
  periode DT (REQ-RDT-SAP-13) SAAT INI berbentuk list scroll panjang — ganti jadi
  pola **navigasi Prev/Next per tahun** (mis. tampilkan bulan-bulan satu tahun
  sekaligus, tombol panah kiri/kanan buat pindah tahun), bukan scroll box.
- `REQ-RDT-UI-08` **(baru 4 Agu)**: Tabel preview DT di MANAPUN (Repost, Wait to
  Repost, transparansi, dst — lihat REQ-RDT-NAV-04) TIDAK PERLU menampilkan kolom
  metadata teknis seperti nomor baris atau nama sheet asal — cuma kolom data DT
  asli (53 kontrak + kolom tambahan dinas) yang relevan buat pengguna.
- **Referensi desain dashboard baru (1 Agu)**: dua frame Figma yang sudah dibuat
  — `Dashboard-SubmissionStatus-RDT` (id `78:242`) untuk dashboard per dinas, dan
  `Dashboard-SummaryProgressAllDinas-RDT` (id `78:243`) untuk dashboard TAB —
  SUDAH DIREVISI LEBIH LANJUT oleh pemilik proyek di Figma. Tarik `get_design_context`
  ke node ini buat versi terbaru sebelum implementasi — JANGAN pakai screenshot/
  deskripsi lama yang mungkin sudah ketinggalan dari revisi pemilik proyek.

### 3.10 Share-Cost oleh TAB (Split Transaksi)

**Priority:** High secara dampak finansial.

> **STATUS 3 Agu: MULAI DIKERJAKAN dengan asumsi paling AMAN** (pemilik proyek minta
> jalan "seadanya dulu" tanpa menunggu jawaban formal ke 3 pertanyaan di bawah) —
> asumsi berikut DIKUNCI sebagai keputusan sementara, dicatat eksplisit di sini biar
> jelas apa yang diasumsikan vs dikonfirmasi:
> 1. **Split HANYA untuk baris berstatus `PENDING`** (belum ada `ledger_entries`
>    sama sekali) — opsi paling aman secara teknis, TIDAK berlaku untuk baris
>    `CONFIRMED` untuk sekarang. Kalau nanti dibutuhkan buat baris CONFIRMED juga,
>    itu perlu desain terpisah (pembatalan ledger entry) — jangan diperluas diam-diam.
> 2. **TAB input manual** besaran tiap baris split (bukan auto-hitung dari sumber
>    data lain) — opsi paling simpel, bisa diperluas nanti kalau ada kebutuhan
>    auto-calculate.
> 3. **Notifikasi ke dinas asal** memakai mekanisme yang sudah ada (REQ-RDT-COMMENT-03
>    diperluas) — split membuat komentar otomatis di thread pasangan asal yang
>    menjelaskan alasan split, dinas asal ke-notify lewat jalur normal, dikirim
>    SETELAH aksi split TAB selesai (bukan minta approval dulu sebelum split).
>
> **PERSEMPIT SCOPE 4 Agu (revisi rencana dari pemilik proyek)**: Share-cost TIDAK
> berlaku untuk sembarang baris — HANYA untuk baris yang `dinas_target`-nya SUDAH
> LANGSUNG **"TAB"** (bukan Corp, bukan dinas biasa, bukan hasil investigasi Ask TA
> yang belum di-assign). Ini artinya **"TAB" sekarang jadi nilai `dinas_target`
> YANG SAH** di `rdt.dinas`/parser — sebelumnya TAB cuma dikenal sebagai ROLE
> pengguna, sekarang juga jadi target dinas yang bisa muncul di data (mirip
> `Corp`). Perlu ditambahkan ke seed `rdt.dinas` dan aturan normalisasi terkait
> (REQ-RDT-EXT-04) kalau ada prefix Remarks yang mengarah ke "TAB" secara
> langsung. Fitur share-cost hanya expose baris dengan `dinas_target='TAB'` sebagai
> kandidat yang bisa di-split — baris dinas lain TIDAK muncul di UI share-cost.
>
> **IMPLEMENTED 5 Agu**: `config/dinas.codes.json` nambah `"TAB"` ke daftar kode
> kanonis (parser resolve prefix Remarks "TAB" langsung, mekanisme sama persis
> yang sudah terbukti jalan buat "TMM" — nol logic parser baru). Migrasi baru
> (`014_tab_share_cost_target.sql`) nambah baris `rdt.dinas` untuk 'TAB' dengan
> `is_active=false` SENGAJA — memenuhi FK `dinas_target` + bisa di-resolve
> parser, TAPI tetap TIDAK muncul di picker dinas aktif manapun (dropdown
> REASSIGN, dst. — semua query itu filter `is_active=true`). `routes/shareCost.js`'s
> `GET /candidates` ditambah `AND t.dinas_target = 'TAB'` ke WHERE clause-nya
> (sebelumnya lintas SEMUA baris PENDING di sistem). Diverifikasi live: insert baris
> tes `dinas_target='TAB'` -> muncul sendirian di `GET /candidates` (baris PENDING
> lain di sistem, incl. TA/TC, tidak ikut); TAB terkonfirmasi absen dari
> `GET /api/dinas` (daftar aktif). `npm test` 65/65 hijau sepanjang perubahan ini.

Ide dari pemilik proyek: TAB bisa "split" satu baris transaksi jadi beberapa baris
dengan dinas_target berbeda-beda dan nominal yang lebih kecil (jumlahnya tetap sama
dengan baris asli). Contoh dari pemilik proyek: satu baris DT senilai 100rb yang
sekarang ada di TH, padahal 65rb dari situ sebenarnya jatah TU — TAB perlu bisa
reassign dengan cara split: baris asli 100rb dihapus/dinonaktifkan, digantikan baris
baru (mis. 35rb tetap TH, 65rb pindah TU).

**Kenapa ini beda dari reassignment yang sudah ada**: seluruh mekanisme reassign
sekarang (REQ-RDT-LEDGER-07, REQ-RDT-LEDGER-10) itu MEMINDAHKAN satu baris utuh ke
dinas_target lain — nominal tidak pernah berubah, cuma target-nya. Split itu
MEMBELAH satu baris jadi beberapa baris dengan nominal baru.

**Desain final (jalan dengan asumsi di atas)**:
- Baris asli ditandai status baru `SPLIT_VOID` dan TIDAK dihitung lagi di
  agregasi manapun.
- Baris-baris baru dibuat dengan data disalin dari baris asli (account, remark, dst),
  nominal & dinas_target sesuai split, status `PENDING` (masuk alur konfirmasi NORMAL
  dari awal — dinas baru yang confirm/decline, sama seperti hasil investigasi
  REQ-RDT-LEDGER-10), kolom baru `split_from_transaction_id` menunjuk baris asli.
- Validasi wajib: SUM nominal seluruh baris hasil split HARUS PERSIS SAMA dengan
  nominal baris asli — tolak kalau tidak pas, jangan biarkan selisih.
- Tercatat di audit log dengan action baru `SPLIT_BY_TAB`, menyertakan baris
  asli & seluruh baris hasil split, plus alasan/catatan TAB (lewat @mention-enabled
  note field, REQ-RDT-COMMENT-03).
- UI: di bawah "Need Identification" (lihat REQ-RDT-NAV-10), TAB pilih satu baris,
  input N baris split (dinas_target + nominal tiap baris), validasi sum real-time
  sebelum submit.

---

## 4. Test Scenario

**Status:** draft awal, akan diperluas bersama tim developer. Prioritas skenario:

1. Approve transaksi normal (happy path) — saldo kedua dinas ter-update benar, log tercatat.
2. Reject transaksi — saldo kembali ke inisiator, log tercatat.
3. Dua request Approve/Reject bersamaan pada baris yang sama (concurrency) — hanya satu yang berhasil, yang lain mendapat pesan konflik, tidak ada partial update.
4. Kegagalan koneksi database di tengah transaksi — rollback penuh, tidak ada saldo yang berubah sebagian.
5. Upload Excel dengan baris invalid (kolom wajib hilang/nominal non-numerik/duplikat) — baris itu ditolak spesifik, baris valid lain tetap masuk. Nominal negatif dengan remark reversal (mis. "Reverse accrue TA") harus DITERIMA, bukan ditolak.
6. Ekspor SAP saat masih ada status PENDING — tombol ekspor nonaktif, pesan peringatan muncul.
7. Pengguna dari dinas A mencoba melihat/validasi transaksi dinas B — ditolak oleh otorisasi.
8. Upload file nyata `contoh_input/06. DT TB - Jun 2026.xlsx` — parser hanya mengekstrak sheet `Subcont` & `Material` (skip pivot & 6 sheet referensi), dan hasil agregasi per dinas target harus match dengan sheet pivot: Expendable TC=85.312,21; TF=360,21; TJ=46.353,37; TL=112.867,35; TN=860,64; Repairable Corp=3.038,48; TC=9.420; Scrap Corp=256,47.

Rancangan antarmuka (mockup/wireframe) mengikuti pola UI existing platform Angular (Select Platform → RDT), bukan didesain dari nol.
