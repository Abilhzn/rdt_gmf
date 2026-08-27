# Infrastructure Requirements Specification

for

**Repost Detail Transaksi (RDT) \u2014 sebagai App di OCX**

Versi 2.0 \u2014 ditulis ulang total 8 Agustus 2026, MENGGANTIKAN versi 1.0 (VM/Docker/
Streamlit/Postgres lokal) yang sudah sepenuhnya obsolete.

---

## 0. Kenapa ditulis ulang total, bukan diselaraskan

Versi 1.0 IRS ditulis untuk visi paling awal project ini (aplikasi Streamlit
berdiri sendiri, VM Ubuntu terpisah, PostgreSQL lokal, akses diblokir total dari
internet). Sebagian tidak lagi berlaku: stack sekarang Node.js/Angular (bukan
Python/Streamlit). Database dev sempat pindah ke Supabase (butuh internet) lalu
kembali lagi ke PostgreSQL lokal (20 Agu) \u2014 lihat tabel section 2. Yang paling
fundamental \u2014 **RDT sekarang dikonfirmasi
sebagai app yang di-"suntik" ke platform OCX milik GMF**, bukan aplikasi berdiri
sendiri dengan VM sendiri.

---

## 1. Model Deployment (dikonfirmasi 8 Agustus 2026)

- GMF punya **server sendiri**.
- RDT (dan nantinya IBT) itu **app terpisah yang di-plug-in ke OCX** \u2014 OCX adalah
  platform/hub yang bisa memilih app apa saja untuk dijalankan di dalamnya.
- Ini KONSISTEN dengan keputusan arsitektur paling awal project ini (23 Jul):
  \"Login/session/auth: inherited from OCX platform; RDT handles feature-level
  authorization only\" \u2014 bukan arah baru, ini penegasan ulang.
- **Implikasi penting**: service `auth/` dan `data_user/` yang kita bangun sendiri
  sekarang (buat testing/development standalone) **kemungkinan besar akan DIBUANG
  TOTAL** saat integrasi OCX beneran terjadi \u2014 bukan sekadar \"ganti isi dalemnya\",
  karena OCX kemungkinan sudah punya sistem identitas sendiri yang lebih lengkap.
  `rdt/backend` tinggal mempercayai identitas yang di-hand-off dari OCX secara
  langsung \u2014 ini sudah punya skeleton-nya: `IDENTITY_MODE=ocx` di `.env`
  mengaktifkan `OcxIdentityProvider`
  (`rdt/backend/src/core/security/ocx-identity.provider.ts`), yang sekarang baca
  identitas dari header `x-ocx-user-id`/`x-ocx-dinas`/`x-ocx-role` \u2014 PLACEHOLDER,
  belum integrasi nyata ke OCX (lihat komentar di file itu sendiri), tapi bentuk
  provider-nya sudah menyiapkan titik sambung buat pertanyaan section 3.2 di bawah.

---

## 2. Yang SUDAH jelas

| Aspek | Status |
|---|---|
| Server produksi | GMF punya sendiri (bukan cloud pihak ketiga) |
| Model integrasi | App di-plug-in ke OCX, bukan berdiri sendiri |
| Auth/session produksi | Diwariskan dari OCX (bukan sistem auth RDT sendiri) |
| Database saat DEVELOPMENT | PostgreSQL lokal (`rdt`, lihat `rdt/backend/.env.example`'s `DB_NAME`) — sempat Supabase, dipindah balik 20 Agu |
| Database saat PRODUKSI | **Belum dikonfirmasi** \u2014 kemungkinan besar server Postgres GMF sendiri, tapi butuh konfirmasi eksplisit dari IT, JANGAN diasumsikan Supabase tetap dipakai |

---

## 3. Pertanyaan WAJIB ditanyakan ke tim IT/OCX GMF (belum bisa dijawab dari sisi kita)

Ini yang paling penting dari dokumen ini \u2014 IRS versi lama gagal karena isinya
asumsi sepihak. Versi ini SENGAJA isinya banyak pertanyaan terbuka, bukan
spesifikasi yang dikarang:

### 3.1 Mekanisme integrasi
- Bentuk paling konkret: apakah OCX \"menyuntik\" app lewat **iframe**, **micro-
  frontend (module federation)**, **reverse-proxy berbasis path** (mis.
  `ocx.gmf.local/rdt/...`), atau mekanisme lain?
- Apakah ada **konvensi build artifact** yang OCX harapkan (format folder, nama
  file entry point, dst) dari app yang mau di-plug-in?
- Apakah RDT perlu di-deploy sebagai **satu unit** (digabung), atau OCX bisa
  nampung beberapa service backend terpisah sekaligus (RDT sekarang punya 4
  service: `auth`, `data_user`, `rdt/backend`, `rdt/frontend` \u2014 meski `auth`/
  `data_user` kemungkinan dibuang saat integrasi beneran, lihat section 1)?

### 3.2 Auth & identitas
- Format hand-off identitas dari OCX ke app (token JWT? session cookie? header
  khusus?) \u2014 ini nentuin bentuk ulang `OcxIdentityProvider`
  (`rdt/backend/src/core/security/ocx-identity.provider.ts`), yang sekarang
  masih placeholder baca header `x-ocx-*` mentah.
- Struktur data karyawan yang OCX/IT punya (sudah disinggung sebelumnya di
  percakapan \u2014 employee ID, field \"dinas\", dst) \u2014 buat mastiin asumsi
  `dinas_target` kita di database cocok sama struktur data mereka.

### 3.3 Infrastruktur teknis
- Versi Node.js yang didukung server GMF (buat mastiin kompatibilitas, terutama
  kalau versi Node di sana lebih lama dari yang dipakai development).
- Apakah server tempat OCX jalan **punya akses internet keluar** (buat `npm
  install` versi baru, dst), atau deployment harus fully offline-bundle
  (`node_modules` di-bundle penuh sebelum diserahkan, bukan di-install di sana)?
- Database produksi: kalau ternyata PostgreSQL milik GMF sendiri \u2014 versi
  PostgreSQL-nya, dan siapa yang provision skema/kredensialnya.
- Kebijakan network (VPN/IP whitelist \u2014 sudah dicatat sebagai open item di SRS
  section 2.7) itu levelnya di OCX (satu pintu buat semua app di dalamnya), atau
  tiap app termasuk RDT perlu atur sendiri?

### 3.4 Proses & timeline
- Siapa PIC dari sisi IT/OCX buat proses integrasi ini, dan ada dokumentasi/
  panduan integrasi App resmi yang bisa dibaca duluan sebelum nanya satu-satu?
- Ada lingkungan **staging/UAT** OCX yang bisa dipakai coba integrasi dulu
  sebelum produksi, atau langsung ke produksi?

### 3.5 Format kolom input/output (baru 14 Agu, belum ada arahan)
- **Input**: RDT sekarang berasumsi file DT yang diupload dinas punya kontrak
  53 kolom (diturunkan dari analisis file contoh TB/TJ asli). BELUM PASTI ini
  representasi format yang akan distandarkan GMF ke depannya — kemungkinan
  besar template resmi (kalau ada) beda/lebih ringkas. Tunggu template dokumen
  contoh input resmi dari IT sebelum asumsi 53 kolom ini dianggap final.
- **Output**: file yang di-download TAB dari "Wait to Repost" (buat di-post ke
  SAP) sekarang juga bawa 53 kolom penuh. Menurut informasi awal, SAP
  kemungkinan cuma butuh subset kolom spesifik (disebutkan: `GL Account`,
  `Profit Ctr. Sebelumnya`, `Profit Ctr. Baru`, dan beberapa lagi yang belum
  lengkap diingat) — BUKAN 53 kolom penuh. Tunggu daftar kolom lengkap dari IT/
  tim SAP sebelum implementasi apapun ke arah ini.

---

## 4. Yang TIDAK relevan lagi dari IRS versi 1.0 (dihapus)

VM spec mandiri (vCPU/RAM/storage), Docker Engine, instalasi PostgreSQL manual,
alokasi Static IP terpisah, domain masking (`repost.gmf.local`), port exposure
manual (8501/5432/22), kebijakan blokir total internet \u2014 semua ini berasumsi RDT
jalan sebagai aplikasi berdiri sendiri di VM sendiri. Begitu model integrasi OCX
dikonfirmasi detailnya (section 3), infrastruktur ini kemungkinan besar **jadi
tanggung jawab platform OCX**, bukan sesuatu yang RDT minta terpisah.

---

**Catatan**: dokumen ini sengaja isinya lebih banyak pertanyaan daripada
spesifikasi pasti \u2014 itu jujur mencerminkan kondisi sekarang. Begitu ada jawaban
dari IT/OCX buat pertanyaan di section 3, dokumen ini perlu direvisi lagi jadi
lebih konkret.
