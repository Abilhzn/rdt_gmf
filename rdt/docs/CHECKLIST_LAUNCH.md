# Checklist Kesiapan Launch RDT

Diadaptasi dari checklist website umum yang dibuat pemilik proyek (Agu 2026) —
tapi RDT itu **tool internal**, bukan website publik, jadi banyak yang dibuang,
diubah urutan prioritasnya, atau malah dibalik. Baca section 0 dulu sebelum
liat checklist-nya, biar gak salah nerapin item yang justru berbahaya kalau
dipasang di tool internal.

---

## 0. Kenapa checklist ini beda dari template umum

RDT itu: **tool internal**, dibatasi akses (rencana IP/VPN whitelist, lihat
SRS section 2.7), user-nya cuma karyawan GMF yang udah login, nanganin data
finansial. Ini artinya:

- **Ditemukan/di-ranking Google itu HARUS DIHINDARI**, bukan dikejar — semua
  soal SEO/sitemap/Open Graph di checklist umum itu KEBALIKAN dari yang kita
  mau.
- **Analytics pihak ketiga (Google Analytics, Hotjar, dst)** itu berarti data
  aktivitas finansial internal GMF terkirim ke server luar — jangan pakai,
  kecuali ada solusi yang di-hosting sendiri/internal.
- **Marketing/conversion content** (testimonial, blog, CTA, checkout flow) itu
  gak relevan sama sekali, RDT bukan produk yang dijual.
- Yang justru **naik prioritasnya jauh lebih tinggi** dari template umum:
  keamanan data finansial, audit trail, backup, karena kesalahan di sini
  langsung berdampak ke laporan keuangan GMF.

---

## 1. 🛡️ KEAMANAN (paling kritis, urus duluan)

### 1.1 🔴 Kontrol Akses Jaringan
- [ ] **IP/VPN whitelisting aktif (SRS 2.7) — MASIH PENDING, blocker eksternal**:
      butuh rentang IP dari IT GMF, di luar kendali kode. Gak bisa dikerjakan
      dari sini — perlu tindak lanjut ke tim IT.
- [x] **`robots.txt` (12 Agu)** — `Disallow: /` ditambahkan di
      `rdt/frontend/dev-shell/public/robots.txt` (ke-serve otomatis lewat
      dev-shell buat testing lokal). **Catatan produksi**: RDT bukan app
      standalone (lihat `rdt/CLAUDE.md` section 2) — di production dia
      ditempel ke OCX, jadi robots.txt yang beneran dipakai user itu OCX
      punya domain, bukan file ini. Perlu diteruskan ke tim OCX/IT supaya
      domain produksi juga punya `Disallow: /`.
- [x] **Audit endpoint tanpa login (12 Agu)** — ketemu **gap nyata**: 6
      endpoint di `rdt/backend` bisa diakses TANPA login sama sekali,
      termasuk `PUT /api/mapping` dan `PUT /api/exclusions` (nge-rewrite
      tabel routing dinas — nentuin transaksi masuk ke dinas mana, dijaga
      FRONTEND DOANG sebelumnya, persis pola bug yang checklist 1.3
      peringatkan tapi di sisi otorisasi). Semua di-gate `requireUser`
      (`/api/directory`, `/api/dinas`, `/api/contract-fields`, `/api/commit`)
      atau `requireUser + requireRole('TAB')` (`/api/mapping`,
      `/api/exclusions` — GET dan PUT). `GET /` dibiarin publik (health/info
      endpoint, sesuai section 2.2).
      **Tambahan**: `data_user` service sendiri (`/employees`,
      `/employees/:id`) juga gak ada auth apapun — service-to-service
      boundary, gak cocok user-token, jadi ditambahin shared internal key
      (`INTERNAL_SERVICE_KEY` env var, header `X-Internal-Key`) yang
      dikirim `auth`/`rdt-backend`'s `dataUserClient.js`. Unset = gak
      dipaksa (aman buat dev lokal, warning muncul di boot), tinggal
      di-set kalau service ini nanti network-reachable beneran.
      Diverifikasi live: unauthenticated ditolak 401, PIC biasa nyoba
      `PUT /api/mapping` ditolak 403 (bukan TAB), TAB + PIC biasa tetap bisa
      pakai endpoint yang emang buat mereka.

### 1.2 🔴 Transport & Header Keamanan
- [ ] HTTPS/TLS aktif (masih pending, biasanya tanggung jawab IT pas hosting di-setup)
- [x] **Security headers dasar (11 Agu)** — `helmet` dipasang di 3 service
      (`auth`, `data_user`, `rdt/backend`), CSP dikunci `'none'` di semua
      directive (JSON-only API, defense-in-depth) + `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`
      (aktif dikirim, baru beneran ditegakkan browser begitu HTTPS jalan).
      Angular dev-shell (`ng serve`, lokal doang) dapet CSP terpisah yang
      lebih longgar via `angular.json`'s `serve.headers` — production
      header tetap tanggung jawab OCX (RDT bukan app standalone, lihat
      `rdt/CLAUDE.md` section 2), lihat `rdt/frontend/dev-shell/README.md`
      section "Security headers" buat penjelasan lengkap.
- [x] **Rate limiting endpoint login (11 Agu)** — `express-rate-limit` di
      `auth/src/auth.routes.js`: 5 percobaan GAGAL per IP per 15 menit,
      lewat itu balas `429 {code:'RATE_LIMITED'}`. Login sukses gak ikut
      ke-hitung (`skipSuccessfulRequests`) — user yang typo lalu bener gak
      ke-lock. Diverifikasi manual: 6 percobaan salah beruntun → 429,
      login manual tetap normal setelah rate limiter kepasang.
- [x] **Session/token expiry (11 Agu)** — token dari `auth` service sekarang
      punya masa berlaku 8 jam (`SESSION_TTL_HOURS` env-configurable,
      default 8). `GET /verify` bedain dua kasus jelas: token kedaluwarsa
      → `401 {code:'SESSION_EXPIRED'}`, token gak dikenal →
      `401 {code:'INVALID_SESSION'}` — bukan satu pesan generik. Terpropagasi
      otomatis ke semua consumer lewat `rdt/backend`'s `requireUser`
      (forward body `/verify` apa adanya).

### 1.3 🔴 Validasi Input & Sanitasi
- [x] **Validasi backend endpoint teks bebas (12 Agu)** — audit ketemu 8
      endpoint yang nerima teks bebas TANPA batas panjang sama sekali
      (backend maupun frontend, kolom DB semua `text` unbounded): upload
      description + `rows[].reviewer_note` (`POST /api/persist`), reply
      Confirm/Reject (`confirmation.js`), note Tanggung
      Sendiri/Reassign/batch-resolve (`reassignment.js`), closing_description
      TAB (`exportBatches.js POST /confirm`), description Investigation
      assign/assign-all (`investigation.js`), komentar manual
      Dashboard-Detailing (`dashboard.js`), alasan split Share-Cost
      (`shareCost.js`). Shared helper `rules/textValidation.js`
      (`validateFreeText`) dipasang di semua 8 titik: cap **2000 karakter**,
      `400 {code:'TEXT_TOO_LONG'}` yang jelas kalau kelebihan, field wajib
      tetap dicek non-kosong (`code:'REQUIRED'`). Unit test
      `test/textValidation.test.js` + verifikasi live (curl, 2001 karakter
      ditolak, teks normal tetap sukses) — `npm test` 82/82 hijau.
- [x] **Audit `innerHTML`/`bypassSecurityTrust` (12 Agu)** — **nol hasil** di
      seluruh `rdt/frontend` dan `auth/frontend`. Teks user (komentar/note)
      dirender lewat `mention-text.component.ts` pakai interpolasi Angular
      biasa (`{{ }}`, auto-escape) — pola yang benar, gak ada yang perlu diganti.
- [x] Parameterized query di SEMUA akses database — **ini sudah konsisten
      dipakai sepanjang project ini** (`$1, $2` di `pg` Client), tinggal jaga
      konsistensi kalau nambah kode baru

### 1.4 🔴 Rahasia & Kredensial
- [x] **`.env` di SEMUA service ada di `.gitignore` (12 Agu, diverifikasi ulang)**
      — root `.gitignore` punya pola `.env`/`.env.*` tanpa prefix path, jadi
      berlaku di semua subfolder (`auth/`, `data_user/`, `rdt/backend/`, dst),
      bukan cuma satu. Dicek via `git check-ignore -v` langsung ke
      `rdt/backend/.env` (satu-satunya `.env` yang ada saat ini) — kena
      match aturan itu. `auth/`/`data_user/` belum punya `.env` sendiri
      (belum butuh secret apapun sekarang), tapi kepolakan yang sama juga
      bakal nutup kalau nanti ditambah.
- [x] **Connection string/API key gak pernah ke-commit (12 Agu, cek riwayat
      commit, bukan cuma file sekarang)** — `git log --all --full-history`
      buat `.env`/`.env.*`/`confidential.txt`: **nol hasil**, gak pernah ada
      di riwayat sama sekali. Sweep isi SELURUH history (`git log --all -p`)
      buat pola `postgresql://user:pass@`, AWS key, PEM private key, Bearer
      token panjang: cuma 1 match, itu pun placeholder contoh di
      `rdt/CLAUDE.md` (`postgresql://postgres:PASSWORD@localhost:5432/rdt_dev`
      — literal kata "PASSWORD", bukan kredensial asli). Bersih.

---

## 2. 💾 KEANDALAN & BACKUP (gap terbesar — belum PERNAH dibahas)

### 2.1 🔴 Backup Database
- [x] **Cek pengaturan backup otomatis Supabase (12 Agu)** — project `rdt`
      di tier gratis: **TIDAK ADA Point-in-Time Recovery/backup otomatis
      sama sekali** (fitur itu baru mulai paket Pro, $25/bulan). Confirmed
      via `get_advisors` security scan (nol hasil, artinya bukan gap yang
      Supabase sendiri flag — PITR emang gak exist di tier ini, bukan
      "kurang di-aktifin"). Detail lengkap + kenapa di `rdt/docs/dump_db.md`.
      **Implikasi**: backup manual di bawah ini SATU-SATUNYA jaring
      pengaman sampai upgrade ke Pro (wajib sebelum data finansial asli
      masuk produksi).
- [x] **Cara manual export/dump (12 Agu)** — `supabase db dump` (metode yang
      awalnya didokumentasikan di `dump_db.md`) ternyata butuh Docker
      Desktop lokal (CLI-nya jalanin pg_dump di dalam container) — gak
      tersedia di mesin ini. Pivot ke tool sendiri, gak butuh dependency
      tambahan: `rdt/backend/tools/backupDatabase.js` (dump semua tabel
      schema `rdt` ke satu file JSON, ditaruh di
      `budgeting_gmf_backups/` — SENGAJA di luar folder yang di-track git,
      sama seperti `dump_db.md` bilang) + `tools/restoreDatabase.js`
      (companion, restore JSON itu ke schema manapun — default
      `rdt_restore_test`, BUKAN `rdt` langsung, biar gak ketimpa gak sengaja).
- [x] **Restore dites beneran (12 Agu, bukan cuma ditulis di dokumentasi)**
      — jalanin `backupDatabase.js` beneran (hasil: 13 tabel, 10.414 baris,
      15 MB), restore ke schema scratch `rdt_restore_test`, **row count
      dicek cocok 100% di SEMUA tabel** (dinas 28/28, transactions
      8863/8863, ledger_entries 974/974, dst) — lalu schema scratch-nya
      di-drop lagi. **Bug ketemu & langsung diperbaiki dalam proses ini**:
      percobaan pertama restore gagal di tengah jalan (koneksi ke-drop pas
      insert tabel `transactions` yang 8863 baris, satu-row-per-query lewat
      pooler connection) — `restoreDatabase.js` diperbaiki pakai batched
      multi-row INSERT (500 baris/batch), percobaan kedua sukses penuh.
      File backup asli (data produksi sungguhan) disimpan di
      `budgeting_gmf_backups/backup_2026-08-12T06-04-41-406Z.json` — di
      luar repo, gak ke-commit.

### 2.2 🔴 Monitoring & Error Handling
- [x] **Endpoint `/health` (12 Agu)** — `auth`/`data_user` sudah punya
      sebelumnya (trivial "process alive"), `rdt/backend` BELUM ADA sama
      sekali sampai sekarang — ditambahkan. Ketiganya sekarang benar-benar
      cek dependency-nya masing-masing, bukan cuma "proses hidup": `rdt/backend`
      round-trip `SELECT 1` ke Supabase (`db: connected/error`), `auth`
      cek `data_user` reachable, `data_user` cek seed file kebaca. Diverifikasi
      live: ketiganya balikin status sehat + detail dependency yang bener.
      **Service ke-4 (Angular dev-shell/frontend)**: gak punya `/health`
      sendiri — di production RDT nempel ke OCX (bukan server yang kita
      kontrol, sama alasannya dengan HTTPS/robots.txt), jadi liveness-nya
      OCX yang tanggung jawab.
- [x] **Error logging terpusat (12 Agu)** — `logger.js` (duplikat per
      service, pola yang sama dengan `dataUserClient.js`) nyatet SETIAP
      response 5xx ke `logs/error.log` (JSON per baris: waktu, service,
      method, path, status, body) lewat middleware yang hook
      `res.on('finish')` — otomatis nangkep SEMUA 5xx tanpa perlu ubah
      satu-satu di 40-an route handler yang udah ada. Diverifikasi live:
      trigger 500 beneran (transaction id gak ada), langsung muncul di
      `error.log` dengan detail lengkap.
- [x] **API timeout handling (12 Agu)** — dua sisi:
      - **Backend**: middleware timeout 30 detik di ketiga service — kalau
        handler gak selesai dalam waktu itu, client dapet
        `503 {code:'REQUEST_TIMEOUT'}` yang jelas, bukan koneksi
        ngegantung selamanya. Dijaga supaya gak crash kalau handler asli
        akhirnya selesai belakangan dan nyoba nulis response lagi (respons
        kedua di-no-op, bukan throw `ERR_HTTP_HEADERS_SENT`).
      - **Frontend**: `TimeoutInterceptor` baru (`rdt/frontend/rdt/shared/timeout.interceptor.ts`,
        didaftar lewat `HTTP_INTERCEPTORS` — sebelumnya app ini GAK PUNYA
        interceptor HTTP sama sekali) — 30 detik juga, error message jelas
        dalam format `{ok:false, error, code:'CLIENT_TIMEOUT'}` yang sama
        kayak response backend biasa, biar kode display error yang udah
        ada gak perlu kasus khusus.

### 2.3 🟠 Data Integrity (sebagian sudah kuat, verifikasi ulang)
- [x] **Transaksi database atomic (12 Agu, re-audit)** — grep menyeluruh
      semua `routes/*.js` + `index.js`: tiap endpoint dengan lebih dari 1
      write statement (INSERT/UPDATE/DELETE) dibungkus `BEGIN`/`COMMIT`
      yang sesuai (jumlah `BEGIN` per file cocok sama jumlah endpoint
      multi-write-nya). Endpoint dengan CUMA 1 statement (`notifications.js`'s
      mark-read, dst) sengaja gak pakai BEGIN eksplisit — satu statement SQL
      di Postgres udah atomic sendiri, gak butuh wrapper. Gak ada gap.
- [x] **Row locking `FOR UPDATE` (12 Agu, re-audit)** — konsisten dipakai di
      SEMUA tempat yang baca-lalu-tulis satu baris `rdt.transactions`:
      `confirmation.js`, `investigation.js` (2x), `reassignment.js`,
      `shareCost.js`, `periodDeadlines.js`. `exportBatches.js POST /confirm`
      pakai pola beda tapi sama-sama aman (`UPDATE ... WHERE export_batch_id
      IS NULL` set-based, Postgres serialize concurrent UPDATE di baris yang
      sama secara native, gak butuh SELECT FOR UPDATE terpisah). Gak ada gap.
- [x] **Audit log coverage (12 Agu, re-audit)** — dihitung per file: jumlah
      UPDATE yang ganti `status_konfirmasi` vs jumlah `INSERT INTO
      rdt.audit_log` — cocok 1:1 atau lebih di SEMUA file
      (`confirmation.js` 3:3, `reassignment.js` 2:2, `shareCost.js` 1:1,
      `investigation.js` 2:2, `index.js` 1:1; `exportBatches.js` malah 3
      audit_log INSERT buat 0 status-UPDATE langsung — batch
      confirm/subdoc/notify semua ke-log biarpun gak nyentuh
      `status_konfirmasi` baris manapun). Gak ada gap.

---

## 3. 📱 UX & ERROR HANDLING (relevan, prioritas sedang)

- [x] **Custom 404/403 page (12 Agu)** — sebelumnya BENERAN GAK ADA:
      URL salah di bawah `/rdt/...` diam-diam gagal navigasi (no feedback
      sama sekali), dan user role salah yang buka URL TAB-only langsung
      (`/rdt/admin`, `/rdt/need-approval`, dst) masuk aja ke shell tanpa
      tanda apapun sampai API call-nya baru 403 belakangan (backend-nya
      sendiri udah benar dari awal, ini gap di sisi frontend doang).
      `shared/error-page.component.ts` (satu komponen, dikonfigur lewat
      route `data`) + `guards/role.guard.ts` baru (route TAB-only sekarang
      pakai `canActivate` + `data:{requiredRole:'TAB'}`) + wildcard `**`
      route. Dicek lewat `ng build` bersih.
- [x] **Empty states (12 Agu, spot-check)** — 9 dari 15 template komponen
      punya pesan state kosong eksplisit ("Tidak ada"/"Belum ada" dst,
      konvensi konsisten di seluruh app) — sisanya bukan halaman berbasis
      list (login, modal, error page, dst) jadi emang gak butuh. Konsisten,
      gak ada gap nyata ketemu.
- [x] **Loading states konsisten (12 Agu, audit menyeluruh)** — grep
      subscribe-calls vs loading-mentions per komponen, lalu dicek satu-satu
      yang mencurigakan. Ketemu 3 gap nyata, semua diperbaiki:
      `admin/mapping-editor.component.ts` & `admin/exclusions-editor.component.ts`
      — REGRESI dari fix checklist 1.1 (`requireUser`/`requireRole('TAB')` baru
      di `/api/mapping`/`/api/exclusions`), kedua komponen ini masih pakai
      `fetch()` mentah tanpa auth header sama sekali, jadi rusak total begitu
      guard itu masuk; ditulis ulang pakai `AdminService` baru
      (`CurrentUserService.authHeaders()`, pola yang sama dipakai fitur lain)
      + loading/saving flag + `ModalService`. `home.component.html` — flag
      `loaded` ada tapi cuma gate empty-state, gak ada indikator "lagi
      dimuat" yang keliatan — ditambah `<p>Memuat dashboard...</p>`.
      `repost-history.component.ts` — gak ada flag loading sama sekali,
      `!batches.length` dipakai dobel buat "masih loading" DAN "emang kosong"
      (gak bisa dibedain) — ditambah flag `loading` + pesan terpisah.
      `confirm.component.ts` — gap terbesar: 6 aksi async (submitDecisions,
      resolveBorne, resolveReassign, submitAllResolutions, assignInvestigation,
      assignAllInvestigation, bulkAssignSelected) sama sekali gak ada
      busy-state guard, tombolnya bisa diklik ganda saat request masih
      in-flight — ditambah flag per-aksi (`submittingDecisions`,
      `resolvingRowId`/`assigningRowId` per-baris mengikuti pola
      `addingSubdocBatchId` yang sudah ada, `submittingAllResolutions`,
      `assigningAllInvestigation`, `bulkAssigning`), tombol terkait
      `[disabled]` + teks "Menyimpan..." selama in-flight.
      `share-cost.component.ts`, `setting-periode.component.ts`,
      `need-approval.component.ts` — sudah punya busy-flag yang benar
      (`submitting`/`bulkDeadlineFormBusy`/`overrideBusyPair`/`confirming`),
      diverifikasi baris-per-baris, gak ada gap. `shell.component.ts` — 6
      subscribe tapi semuanya background/suplementer (badge notifikasi,
      hitungan dashboard, logout yang langsung redirect) — gak butuh
      busy-state UI. `ng build` bersih setelah semua fix.
- [x] **Error states jelas & actionable (12 Agu, diperbaiki)** — pattern
      `err?.message || err` app-wide (30 titik panggilan di 8 komponen)
      buat `HttpErrorResponse` Angular balikin pesan generik ("Http failure
      response for ...") BUKAN pesan asli dari backend (`err.error.error`).
      Dibuat satu helper `shared/error-message.util.ts`
      (`extractErrorMessage(err, fallback)`, precedence: `err.error.error` →
      `err.message` → fallback) dan semua 30 titik panggilan diganti untuk
      pakai itu — `confirm.component.ts` (11), `need-approval.component.ts`
      (5), `repost-history.component.ts` (3), `setting-periode.component.ts`
      (3), `share-cost.component.ts` (3), `dashboard-detail.component.ts`
      (2, sudah benar sebelumnya, dikonsolidasi ke helper bersama),
      `home.component.ts` (1, sama), `pages/repost-budgeting.component.ts`
      (2, sama). Diverifikasi: grep pattern lama return kosong di seluruh
      `.ts`, `ng build` bersih.
- [x] **Success feedback (12 Agu, audit systematic)** — dicek tiap aksi
      finansial/mutating: `confirm.component.ts` (submitDecisions,
      resolveBorne, resolveReassign, submitAllResolutions,
      assignInvestigation, assignAllInvestigation, bulkAssignSelected),
      `need-approval.component.ts` (confirmPair), `share-cost.component.ts`
      (split), `setting-periode.component.ts` (override deadline, bulk
      deadline), `pages/repost-budgeting.component.ts` (persist) — semuanya
      punya `modal.success()`/`modal.alert()` di jalur `next:` (bukan cuma
      di `error:`). Gak ada gap ketemu.

### 3.1 🟠 Aksesibilitas dasar (biaya rendah, worth dicek)
- [x] **Keyboard navigation (12 Agu)** — audit `(click)` di elemen non-native
      (`<div>` dkk) ketemu 1 gap nyata: `home.component.html`'s pair-card
      (interaksi drill-down utama Dashboard) cuma bisa di-klik mouse, gak
      ada `tabindex`/keyboard handler sama sekali. Diperbaiki: `role="button"`
      + `tabindex="0"` + `(keydown.enter)`/`(keydown.space)`, plus
      `:focus-visible` outline baru (sebelumnya gak ada state fokus
      keliatan sama sekali). Form-form utama (login, repost, dst) sudah
      pakai native `<button>`/`<input>` — otomatis keyboard-accessible,
      gak ada gap di situ.
- [x] **Kontras warna (12 Agu)** — dicek pakai formula WCAG relative-luminance
      langsung: **$amber gagal parah** (2.72:1, jauh di bawah minimum AA
      4.5:1 buat teks) dan **$green juga gagal** (3.62:1) — persis dugaan
      checklist ini sendiri ("kuning/orange di atas putih sering kurang
      kontras"). Diperbaiki: digelapkan ke hue yang sama (`$amber` →
      `#a36914` = 4.58:1, `$green` → `#188257` = 4.81:1, keduanya lolos AA
      sekarang), diterapkan di 3 file yang duplikat token ini
      (`home.component.scss`, `setting-periode.component.scss`,
      `chain-hop-detail.component.scss`). `$red`/`$accent`/`$ink-600`
      sudah lolos dari awal (dicek juga, semua >4.5:1), gak disentuh.
- [x] **Label form terhubung ke input (12 Agu, spot-check)** — pola yang
      dipakai konsisten di seluruh app: `<label>` MEMBUNGKUS `<input>`-nya
      langsung (asosiasi implisit, sama validnya secara a11y dengan
      `for`/`id` eksplisit) — dicek beberapa halaman representatif
      (Repost, Setting Periode, Confirmation), semua pola sama. Gak ada
      gap ketemu.

### 3.2 ⚪ Perlu ditanya balik, bukan diasumsikan
- [x] **Mobile responsiveness — DIJAWAB (12 Agu)**: TAB/PIC kerja dari
      laptop/desktop kantor, bukan requirement nyata. **Keputusan: gak
      dikerjakan**, sesuai instruksi checklist sendiri ("jangan buang
      effort kalau bukan requirement nyata").

---

## 4. 📝 DOKUMENTASI (sudah kuat, cross-reference)

- [x] SRS lengkap (`docs/SRS.md`)
- [x] Panduan teknis buat non-web-dev (`docs/PANDUAN_TEKNIS.md`)
- [x] Panduan baca kode (`docs/PANDUAN_KODINGAN.md`)
- [x] Memory/context project buat Claude Code (`CLAUDE.md`, tiap service)
- [x] **README per service (12 Agu)** — `auth/README.md` dan
      `data_user/README.md` BELUM ADA sama sekali sampai sekarang, ditulis
      baru. `rdt/frontend/README.md` juga baru (belum ada top-level README
      buat folder ini, cuma ada `dev-shell/README.md` yang scope-nya lebih
      sempit). `rdt/backend/README.md` DIREVISI — versi lama masih nunjuk
      ke "demo UI di /rdt/demo" yang udah dihapus 7 Agu, aktif menyesatkan
      orang baru, bukan cuma kurang lengkap.
- [x] **Runbook (12 Agu)** — `rdt/docs/RUNBOOK.md` baru: cara cek service
      mana yang mati (`/health` tiap service, sekarang beneran ngecek
      dependency masing-masing berkat checklist 2.2), cara restart per
      service, 2 failure mode yang KETEMU BENERAN di sesi-sesi sebelumnya
      (migration gagal karena DNS blip ke Supabase, `ng serve` nyangkut
      serve kode lama), cara cek `error.log`, pointer ke restore backup.

---

## 5. ❌ JANGAN DITERAPKAN (dari checklist asli, salah konteks buat tool internal)

- SEO (sitemap, meta description, Google Search Console, structured data)
- Open Graph / Twitter Card / social share image
- Google Analytics / Hotjar / session replay / heatmap
- Blog, case study, testimonial, team photo, "About page"
- Checkout flow, sticky mobile CTA, conversion optimization
- Internationalization (i18n) — RDT internal GMF, satu bahasa cukup
- PWA / install-to-home-screen — gak relevan buat internal tool
- Dark mode — boleh someday, tapi bukan prioritas

---

## 6. Urutan pengerjaan yang disarankan

**Fase 1 (sebelum data finansial asli masuk):** semua item 🔴 di section 1
(Keamanan) dan 2 (Backup) — ini yang paling gak bisa ditunda, karena begitu
data asli masuk, telat benerin keamanan/backup itu risikonya jauh lebih gede
daripada telat benerin UI.

**Fase 2:** section 3 (UX/error handling) — sebagian besar sudah jalan,
tinggal audit & lengkapi.

**Fase 3:** section 4 (dokumentasi tambahan) — nice to have, gak blocking.

**Jangan pernah:** section 5 — kalau ada yang nyaranin nambahin salah satu
dari situ ke RDT suatu saat, balik cek dulu section 0 kenapa itu gak relevan/
berbahaya.
