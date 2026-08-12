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
- [ ] IP/VPN whitelisting aktif (SRS 2.7) — masih pending, butuh rentang IP dari IT GMF
- [ ] `robots.txt` isinya `Disallow: /` (larang SEMUA crawler) — KEBALIKAN dari
      website umum, ini WAJIB ada, bukan opsional
- [ ] Tidak ada halaman/endpoint yang bisa diakses tanpa login sama sekali

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
- [ ] **Cek pengaturan backup otomatis Supabase** — apakah Point-in-Time
      Recovery aktif, berapa lama retention-nya, apakah itu cukup buat
      kebutuhan audit finansial GMF (mungkin perlu lebih dari default)
- [ ] Punya cara manual buat export/dump data sewaktu-waktu (bukan cuma
      andelin backup otomatis penyedia)
- [ ] Sudah PERNAH dicoba restore dari backup minimal sekali (backup yang
      gak pernah dites itu sama aja gak ada backup)

### 2.2 🔴 Monitoring & Error Handling
- [ ] Endpoint `/health` di tiap 4 service, buat tau service mana yang mati
      tanpa harus cek manual satu-satu
- [ ] Error logging terpusat (gak harus Sentry, bisa simpel — tapi HARUS ada
      cara TAB/dev tau kalau ada error di production tanpa nunggu user lapor)
- [ ] API timeout handling — user dapet pesan jelas kalau request nge-hang,
      bukan spinner selamanya

### 2.3 🟠 Data Integrity (sebagian sudah kuat, verifikasi ulang)
- [ ] Transaksi database atomic (`BEGIN...COMMIT...ROLLBACK`) — **sudah
      konsisten dipakai**, cek gak ada endpoint baru yang lupa
- [ ] Row locking (`FOR UPDATE`) buat cegah race condition — **sudah ada**,
      verifikasi masih konsisten
- [ ] Audit log (`rdt.audit_log`) mencakup SEMUA aksi finansial penting —
      **sudah luas cakupannya**, audit sekali lagi menyeluruh sebelum launch

---

## 3. 📱 UX & ERROR HANDLING (relevan, prioritas sedang)

- [ ] Custom 404/403 page yang informatif (bukan generic error Angular)
- [ ] Loading states konsisten (sudah banyak dibangun, audit menyeluruh)
- [ ] Empty states ("belum ada yang perlu dikonfirmasi" dst) — sudah ada di
      beberapa halaman, cek konsisten di semua
- [ ] Error states jelas & actionable (bukan cuma console error)
- [ ] Success feedback yang jelas setelah aksi penting (Confirm, Repost, dst)

### 3.1 🟠 Aksesibilitas dasar (biaya rendah, worth dicek)
- [ ] Keyboard navigation (Tab/Enter/Escape) berfungsi di form-form utama
- [ ] Kontras warna cukup (terutama badge status berwarna — kuning/orange di
      atas putih sering kurang kontras)
- [ ] Label form terhubung ke input (`<label for="">`)

### 3.2 ⚪ Perlu ditanya balik, bukan diasumsikan
- [ ] **Mobile responsiveness** — apakah RDT beneran perlu diakses dari HP?
      TAB/PIC kemungkinan kerja dari laptop/desktop di kantor. Kalau bukan
      requirement nyata, jangan buang effort ke sana.

---

## 4. 📝 DOKUMENTASI (sudah kuat, cross-reference)

- [x] SRS lengkap (`docs/SRS.md`)
- [x] Panduan teknis buat non-web-dev (`docs/PANDUAN_TEKNIS.md`)
- [x] Panduan baca kode (`docs/PANDUAN_KODINGAN.md`)
- [x] Memory/context project buat Claude Code (`CLAUDE.md`, tiap service)
- [ ] README singkat per service (`auth/`, `data_user/`, `rdt/backend/`,
      `rdt/frontend/`) buat orang baru yang belum baca SRS lengkap
- [ ] Runbook: "kalau service X mati, gimana cara restart-nya" — sudah
      sebagian ada di `CLAUDE.md` section 5, worth dirapikan jadi dokumen
      sendiri kalau makin kompleks

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
