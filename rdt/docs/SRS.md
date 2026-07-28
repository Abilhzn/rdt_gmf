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
- `TA` — sebelumnya kita anggap sudah pensiun/gabung ke `TAB`, tapi muncul lagi di data nyata sebagai target terpisah.
- `Ask TA` — **SUDAH TERJAWAB 27 Jul**: ini BUKAN dinas, ini penanda "perlu investigasi TAB" — lihat REQ-RDT-LEDGER-10 untuk alur lengkapnya. Jangan dimasukkan ke `dinas_mapping` sebagai dinas biasa.
- `TMM` — kode 3 huruf, di luar pola 2-huruf (`TB`–`TU`) yang selama ini diasumsikan sebagai roster 20 dinas.
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

### 3.3 SAP Flattening Gatekeeper

**Priority:** High

Mencegah ekspor final jika masih ada selisih rekonsiliasi; memformat data menjadi matriks SAP.

> **UPDATE 20 Jul** — sebelum export, data final harus melewati **approval berjenjang dinas TA**: Senior Manager lalu Group Head (level batch, tabel `rdt.export_batches`: DRAFT → WAITING_SM → WAITING_GH → APPROVED → EXPORTED). Export hanya bisa dieksekusi pada batch berstatus APPROVED.

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

- `REQ-RDT-AUTH-04` **(koreksi 22 Jul terhadap implementasi saat ini; role `ADMIN_TAB` diganti nama jadi `TAB` per koreksi 24 Jul)**: Konfirmasi transaksi dengan `dinas_target = 'Corp'` HANYA boleh dilakukan oleh role `TAB`. Corp tetap tidak punya PIC dedicated (baris data `dinas_target='Corp'` tidak berubah), tapi yang berhak bertindak atas namanya cuma role `TAB`. Sudah diterapkan di `middleware/auth.js` (`requireDinasAccess`).
- `REQ-RDT-AUTH-05` **(SUPERSEDED 24 Jul — role `SM_TA`/`GH_TA` dihapus total, koreksi project owner)**: Sistem hanya punya dua role sekarang: `PIC` (dinas operasional) dan `TAB` (menggantikan seluruh urusan yang dulunya dipecah antara `SM_TA`/`GH_TA`/`ADMIN_TAB` — approve semua pengajuan/repost begitu 100% terkonfirmasi, approve pengajuan untuk Corp, dan melihat Dashboard-Detailing untuk SEMUA pasangan dinas termasuk thread komentar). Repost dan Confirmation tidak lagi punya role-gate sama sekali (setiap role yang tersisa sudah diizinkan di keduanya) — kebutuhan pemblokiran role eksplisit (`blockRoles`) yang dulu ada untuk `SM_TA`/`GH_TA` sudah tidak relevan dan sudah dihapus dari kode.

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
- `REQ-RDT-NAV-04` (halaman **Repost**, node `20:499`): 2 kolom.
  - **Kolom kiri**: "Upload" (drop file/select from device) di atas, "Review" ("Review
    Detailing Transaction Before Upload") di bawah — review detail transaksi hasil
    parse SEBELUM benar-benar diunggah ke staging.
  - **Kolom kanan, panel persisten "Confirm to Repost"**: tombol **Confirm** dan
    **Cancel** — aksi final setelah review (Cancel = batalkan, tidak menyimpan apapun).
    Ini menggantikan tombol tunggal "Simpan ke staging" di `ui-demo.html` versi
    sebelumnya — perlu ada opsi batal yang eksplisit.
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
- `REQ-RDT-NAV-06`: Struktur ini berlaku untuk `ui-demo.html` MAUPUN source Angular di
  `src/frontend/rdt/` — keduanya harus tetap sinkron secara struktur navigasi, sesuai
  aturan sinkronisasi di `src/README.md`. Modul Angular yang sudah ada (`home/`,
  `confirm/`, `need-approval/`, `pages/repost-budgeting/`) kemungkinan sudah dipetakan
  sebagian ke struktur ini — cek dulu sebelum bikin struktur baru dari nol.
- `REQ-RDT-NAV-07` **(baru 22 Jul)**: Tabel besar (Review di halaman Repost, tabel di
  halaman Confirmation) menggunakan pagination pola "Google-style": maksimum **100
  baris per halaman**; kontrol Previous/Next; nomor halaman yang tampil maksimum
  **5 angka sekaligus**; kalau total halaman lebih dari yang muat, tampilkan `...`
  di ujung yang terpotong (awal dan/atau akhir) — klik nomor halaman manapun yang
  terlihat untuk loncat langsung ke situ, `...` tidak perlu diklik (cukup indikator
  ada halaman lain di luar rentang, nomor di sekitar halaman aktif yang bergeser saat
  navigasi). Komponen ini harus reusable (dipakai di kedua tabel, bukan diimplementasi
  dua kali secara terpisah).
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
