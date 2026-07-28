# Infrastructure Requirements Specification
## Repost Detail Transaksi (RDT) — Modul Budgeting/TAB

Version 1.2 draft — updated setelah konfirmasi stack bersama tim IT (17 Jul 2026)
Prepared by Muhammad Abil Hasan — Divisi TAB, GMF AeroAsia

---

## 0. Perubahan Penting (v1.2)

Versi awal IRS (v1.0) mengasumsikan RDT adalah **aplikasi standalone** yang butuh VM sendiri, Docker, dan provisioning jaringan sendiri (static IP, port 8501/5432/22, dsb). Setelah konfirmasi dengan tim IT, **asumsi ini tidak berlaku lagi**:

RDT adalah module/route baru di dalam aplikasi web internal GMF yang sudah ada dan sudah dikelola tim IT (Angular frontend + Node.js backend + PostgreSQL). Konsekuensinya, **sebagian besar permintaan infrastruktur di v1.0 sudah otomatis terpenuhi** oleh infrastruktur existing dan tidak perlu diajukan ulang:

| Kebutuhan v1.0 | Status di v1.2 |
| --- | --- |
| VM baru (2 vCPU, 4-8GB RAM) | Tidak diperlukan — jalan di infra existing |
| Docker Engine & Compose | Tidak diperlukan — deployment ikut pipeline existing tim IT |
| Static IP + domain masking | Tidak diperlukan — sudah pakai domain portal existing (`*.gmf-aeroasia.co.id`) |
| Port 8501 (Streamlit) | Tidak relevan — FE sekarang Angular, bergabung ke build existing |
| Port 22 (SSH maintenance) | Tidak diperlukan — maintenance lewat akses repo/CI tim IT |
| PostgreSQL superuser credential | Berubah jadi permintaan **schema/skema baru + role terbatas**, bukan superuser (lihat 2) |

Yang **masih perlu diajukan** ke tim IT:

## 1. Akses Repository & Deployment

- Akses ke repository Angular (frontend) dan Node.js (backend) yang sudah ada, untuk menambahkan module/route baru khusus RDT.
- Panduan konvensi kode tim IT: struktur folder, lint/style config, pola state management (Angular) dan pola service/controller (Node.js), agar kontribusi baru konsisten dengan yang sudah ada.
- Alur deployment/CI-CD yang berlaku untuk perubahan pada kedua repo tersebut (siapa yang review, siapa yang merge, siapa yang deploy ke intranet).

## 2. Database (PostgreSQL)

- Instance PostgreSQL yang dipakai: konfirmasi apakah RDT memakai instance yang sama dengan aplikasi IT lain, atau instance khusus modul TAB (RDT + IBT + dst).
- Diminta **schema/namespace terpisah** untuk RDT (misal schema `rdt`) di dalam instance tersebut, untuk mengantisipasi modul lain (IBT) belakangan tanpa konflik penamaan tabel.
- Role/credential database dengan hak terbatas (DML pada schema `rdt` saja), bukan superuser — mengikuti prinsip least privilege karena data yang ditangani adalah data finansial.
- Kapabilitas row-level locking (`SELECT ... FOR UPDATE`) harus tersedia — standar di PostgreSQL, tinggal konfirmasi tidak ada pembatasan khusus dari sisi hosting.
- Strategi backup & retention PostgreSQL — masih perlu dikonfirmasi ke tim IT (kemungkinan besar sudah ada kebijakan umum di level instance, tinggal diikuti, bukan dibuat baru oleh tim RDT).

## 3. Autentikasi & Otorisasi

- Akses ke tabel/skema pengguna (employee/user) yang sudah dikelola tim IT, untuk keperluan otorisasi berbasis fitur (lihat SRS 3.7, `REQ-RDT-AUTH-01..03`).
- Konfirmasi mekanisme identitas pengguna yang login diteruskan ke service baru RDT: JWT claim, shared session/cookie, atau API internal user service.
- Konfirmasi apakah IP whitelisting & login sudah otomatis berlaku untuk route baru RDT begitu didaftarkan di aplikasi existing, atau ada langkah registrasi tambahan.

## 4. Lingkungan Development Lokal (untuk tim RDT/developer)

- Node.js versi yang dipakai backend existing (untuk disamakan di environment development).
- Akses baca (read replica atau dump berkala) ke schema `rdt` untuk keperluan development/testing lokal, tanpa menyentuh data produksi modul lain.

---

## Open Questions ke Tim IT

1. Apakah RDT & IBT akan jadi dua module Angular terpisah dalam satu route group, atau digabung jadi satu module besar "Budgeting"?
2. Nama tabel/skema pengguna existing dan kolom yang menandakan dinas/role seorang pegawai.
3. Kebijakan backup PostgreSQL yang berlaku saat ini (frequency, retention).
4. Proses review/merge untuk kontribusi kode dari luar tim IT (siapa PIC review dari sisi IT).
