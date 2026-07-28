# CLAUDE.md — project root

Restrukturisasi 24 Jul 2026: repo ini bukan cuma RDT lagi. Rencananya bakal
ada beberapa web app budgeting di sini (RDT sekarang, **IBT** menyusul),
jadi `auth` dan `data_user` ditarik keluar jadi service bersama, bukan
kepunyaan satu app.

```
budgeting_gmf/                  (root repo ini)
├─ auth/            — service login/session, dipanggil semua app lewat HTTP
├─ data_user/        — service data karyawan/dinas, dipanggil auth + app
├─ rdt/              — app Repost Detail Transaksi (lihat rdt/CLAUDE.md)
│   ├─ backend/
│   └─ frontend/
└─ ibt/              — (coming soon, app budgeting lain)
    ├─ backend/
    └─ frontend/
```

**Status restrukturisasi (24 Jul 2026)**: Phase 1 (pemisahan folder + kode,
`rdt/backend` masih manggil `auth`/`data_user` lewat local require) vs
Phase 2 (auth/data_user jadi service HTTP beneran, port sendiri, dipanggil
lewat network) — cek progres aktual di masing-masing folder, jangan asumsi
salah satu fase sudah selesai tanpa verifikasi. Sistem auth/data_user ini
sendiri masih **provisional/synthetic** (TODO(IT-AUTH)) — akan diganti
total begitu tim IT GMF konfirmasi tabel karyawan resmi mereka.

**Kerja per-app**: baca `CLAUDE.md` di dalam folder app yang bersangkutan
(`rdt/CLAUDE.md`, nanti `ibt/CLAUDE.md`) — itu yang berisi detail bisnis,
status implementasi, dan aturan kerja app tersebut. File ini (root) cuma
untuk hal yang genuinely lintas-app: struktur folder, auth/data_user
sebagai service bersama, dan konvensi git/secrets di level repo.

**Git/secrets**: `.gitignore` di root ini meng-exclude `.env` di semua
subfolder (`auth/.env`, `data_user/.env`, `rdt/backend/.env`, dst) dan
`confidential.txt`. Verifikasi `.gitignore` benar-benar meng-exclude
sebelum commit apapun yang menyentuh file baru di dekat kredensial. Jangan
pernah membaca isi `confidential.txt` kecuali diminta eksplisit oleh user.
