# Panduan Teknis RDT — Buat Kamu yang Baru di Web Dev

## 1. Gambaran Besar: 4 "Kotak" yang Saling Ngobrol

Bayangin RDT itu bukan 1 program besar, tapi **4 program kecil terpisah** yang saling telepon-teleponan lewat internet (protokol HTTP), masing-masing punya "nomor telepon" sendiri (port):

| Kotak | Port | Tugasnya |
|---|---|---|
| `data_user` | 4002 | Nyimpen data karyawan (siapa, dinas apa, role apa) — paling sederhana, kayak buku telepon |
| `auth` | 4001 | Satpam — cek username/password, kasih "kartu akses" (token) |
| `rdt/backend` | 4000 | Otak bisnis — semua aturan (upload Excel, konfirmasi, reassign, dst) |
| `rdt/frontend` (Angular) | 4200 | Wajah — yang kamu lihat & klik di browser |

**Kenapa dipecah gini, bukan 1 program aja?** Analogi: kayak restoran yang misahin dapur (backend), kasir (auth), gudang bahan (data_user), dan ruang makan (frontend) — masing-masing bisa direnovasi/diganti sendiri tanpa bongkar semuanya. Alasan teknisnya: kalau nanti tim IT GMF kasih sistem auth mereka sendiri, kita tinggal ganti isi kotak `auth`/`data_user` doang, kotak `rdt/backend` gak perlu disentuh sama sekali.

## 2. Alur Konkret: Apa yang Kejadian Pas Kamu Login

1. Browser kamu buka `localhost:4200` (Angular) → tampil halaman Login
2. Kamu ketik username/password → Angular kirim ke `rdt/backend` (port 4000)
3. `rdt/backend` gak ngecek password sendiri — dia telepon `auth` (port 4001): "ini username/password bener gak?"
4. `auth` telepon `data_user` (port 4002): "orang ini beneran ada gak, dinas apa, role apa?"
5. Kalau cocok, `auth` kasih **token** (semacam gelang tangan konser — bukti kamu udah "masuk", dicek tiap kali kamu minta sesuatu)
6. Token itu disimpen di browser kamu, dikirim ulang tiap request berikutnya (`X-Session-Token`)

## 3. Database — PostgreSQL, Tabel yang Paling Penting

- `rdt.transactions` — jantungnya. Tiap baris = 1 baris DT dari Excel yang di-upload, plus `status_konfirmasi` (PENDING/CONFIRMED/DECLINED/dst), `dinas_inisiasi`, `dinas_target`
- `rdt.export_batches` — catatan tiap kali TAB "repost" satu pasangan dinas ke SAP
- `rdt.export_subdocs` — nomor referensi SAP hasil repost (bisa lebih dari 1 per batch)
- `rdt.comments` + `rdt.notifications` — thread diskusi & notifikasi
- `rdt.audit_log` — jejak SEMUA aksi penting (siapa ngapain kapan) — ini penting banget buat akuntabilitas finansial

## 4. Security — Ini Bagian yang Paling Kamu Perlu Perhatiin

### Yang UDAH ada (lumayan solid buat tahap ini):
- **Token-based auth** (bukan cuma nama dinas doang, ada verifikasi beneran)
- **Role-based access** — PIC cuma bisa akses dinasnya sendiri, TAB akses lebih luas, dicek di `middleware/auth.js`
- **Audit log** — semua aksi finansial (confirm, reject, reassign, repost) tercatat siapa+kapan
- **SQL injection protection** — kita pakai *parameterized query* (`$1, $2` di kode SQL) di semua tempat, bukan nge-gabung string mentah — ini pertahanan standar & sudah konsisten dipakai

### Yang BELUM ada, dan PERLU sebelum ini beneran dipakai produksi:

1. **Pembatasan jaringan (IP/VPN whitelist)** — udah kita bahas, ini yang paling urgent. Tanpa ini, siapapun yang tau URL-nya bisa coba akses dari mana aja.
2. **HTTPS/TLS** — sekarang komunikasi (termasuk password!) masih lewat `http://` biasa (gak dienkripsi). Kalau di-deploy ke server beneran, WAJIB pasang sertifikat SSL (`https://`) — biasanya ini tanggung jawab tim IT pas hosting-nya di-setup, bukan kode kita.
3. **Rahasia/`.env`** — password database, dll disimpen di file `.env` yang **sengaja di-gitignore** (gak ikut ke-upload ke Git). Ini udah bener, tapi kamu HARUS mastiin file `.env` gak pernah ke-share/ke-screenshot ke siapapun.
4. **Rate limiting** — belum ada pembatas "berapa kali orang boleh coba login gagal sebelum diblokir sementara". Ini pertahanan lawan brute-force (nebak password berkali-kali).
5. **Session expiry** — perlu dipastikan token itu ada masa berlakunya (gak selamanya valid), biar kalau laptop ilang, token lama otomatis gak bisa dipake lagi.
6. **`.env` di 3 tempat berbeda** (`auth/`, `rdt/backend/`) — pastikan SEMUANYA ada di `.gitignore`, jangan cuma satu.

### Soal "Accessibility" — dua makna berbeda, biar jelas:
- **Yang kamu maksud selama ini** (bisa diakses dari mana) = itu masuk kategori **security/jaringan** di atas (poin 1)
- **Makna lain** (aksesibilitas web beneran — buat orang dengan disabilitas, pakai screen reader dll) — ini BELUM pernah kita bahas sama sekali, dan **gak wajib** buat internal tool kayak RDT, tapi worth diinget kalau suatu saat ada requirement compliance dari GMF soal ini.

## 5. Prioritas Kalau Mau Ngelanjutin

1. **Sekarang**: dapetin rentang IP VPN/LAN dari IT → minta Claude Code bikin middleware jaringan
2. **Sebelum serius dipakai orang banyak**: HTTPS, rate limiting, session expiry
3. **Terus-menerus**: jangan pernah commit `.env`/password ke Git, cek `.gitignore` rutin
