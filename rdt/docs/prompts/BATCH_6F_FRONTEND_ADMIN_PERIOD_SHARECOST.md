# PROMPT — Batch 6f: Frontend — Admin + Setting-periode + Share-cost (penutup Batch 6)

> Tempel ke agent eksekutor. Jalankan SETELAH 6a. Independen dari 6b-6e, boleh paralel. Rujukan:
> `RENCANA_REWRITE_NESTJS.md` (§8 Batch 6). Backend & `auth/frontend/` **JANGAN diubah**. Ini
> penutup Batch 6 — begitu selesai, restrukturisasi frontend tuntas, lanjut Batch 7 (finishing).

## Konteks

Tiga panel TAB-only kecil, self-contained (masing-masing sudah 1 komponen tersendiri di kode lama
— tak perlu dipecah sebesar 6b/6c):
- `rdt/frontend/rdt/admin/{mapping-editor,exclusions-editor}.component.ts` → Batch 2 (mapping/exclusions).
- `rdt/frontend/rdt/setting-periode/setting-periode.component.ts` → Batch 5.5a (period-deadlines).
- `rdt/frontend/rdt/share-cost/share-cost.component.ts` → Batch 5.5b (share-cost split).

**Kontrak backend-nest (sudah pasti):**
- **Mapping**: `GET/PUT repost/mapping` (TAB-only). PUT = **MERGE/upsert** (`{"<prefix>":
  "<dinas_code>"}` — key yang tak disebut TETAP ADA, tidak terhapus).
- **Exclusions**: `GET/PUT repost/exclusions` (TAB-only). PUT = **REPLACE-ALL**
  (`{"prefixes":[...]}` — beda semantik dari mapping, ganti seluruh isi). **UI HARUS membedakan
  dua semantik ini secara jelas** — form mapping = "tambah/update satu entri", form exclusions =
  "edit keseluruhan daftar lalu simpan semua".
- **Period Deadlines**: `GET repost/period-deadlines/current-reminder` (semua user, bukan TAB-only
  — reminder banner). `GET/POST repost/period-deadlines/` (per-pasangan, TAB). `GET/POST
  repost/period-deadlines/default` (default periode-wide, POST **sweep** ke pasangan existing,
  tampilkan hasil `swept[]` ke user setelah submit biar jelas efeknya). `DELETE
  repost/period-deadlines/default/:periode` (**hanya kalau deadline masih masa depan** — 400 kalau
  sudah lewat, UI sebaiknya disable tombol hapus utk deadline yang sudah lewat, bukan cuma
  andalkan error server). `GET .../overdue`, `GET .../active-pairs` (informational, TAB).
- **Share Cost**: `GET repost/share-cost/candidates?q=` (TAB, baris PENDING dgn `dinas_target='TAB'`
  persis). `POST repost/share-cost/:transactionId/split` body `{splits:[{dinas_target,nominal}],
  note}` — **`splits` minimal 2 baris**, **SUM nominal split HARUS PERSIS SAMA** dengan nominal
  asli (validasi di server pakai sen/integer — UI sebaiknya tampilkan running-total vs target biar
  user nggak coba-coba submit yang salah), `note` **wajib**. Dropdown `dinas_target` per split →
  **`GET /dinas` aktif-saja** (23 baris, is_active=true — sama aturan seperti 6c).

## Tugas

1. **`features/admin/`**: `pages/mapping-editor-page.component.ts`, `pages/exclusions-editor-
   page.component.ts` (pertahankan sebagai 2 halaman terpisah seperti kode lama, atau gabung satu
   page dengan tab — keputusan eksekutor, yang penting semantik merge-vs-replace tetap jelas beda
   di UI), `services/mapping.service.ts`.
2. **`features/period-deadlines/`**: `pages/period-deadlines-page.component.ts`,
   `services/period-deadlines.service.ts`. Reminder banner (`current-reminder`) — cek apakah ini
   dipakai di tempat LAIN juga (mis. shell/dashboard) selain halaman setting-periode sendiri; kalau
   iya, taruh service-nya di lokasi yang bisa diakses lintas fitur (`core/` atau `shared/`), jangan
   di dalam `features/period-deadlines/` doang.
3. **`features/share-cost/`**: `pages/share-cost-page.component.ts`,
   `components/split-form.component.ts` (DUMB, running-total validator), `services/share-
   cost.service.ts`.
4. **Baca ketiga komponen ASLI dulu** sebelum menulis ulang — sudah self-contained & relatif kecil,
   tapi tetap port UX yang ada, jangan desain ulang dari nol.
5. Semua tiga fitur **TAB-only** di level routing (`RoleGuard`, sudah ada dari 6a) KECUALI
   `current-reminder` yang boleh diakses siapa pun.

## Acceptance
- [ ] Mapping: tambah 1 entri baru → entri lama tetap ada (merge terbukti di UI, bukan cuma di server).
- [ ] Exclusions: edit daftar → submit → seluruh daftar lama tergantikan (replace-all terbukti).
- [ ] Period deadlines: set default → tampilkan pasangan yang ter-sweep. Hapus deadline masa depan
  sukses; tombol hapus utk deadline lewat ter-disable atau minimal jelas kenapa gagal.
- [ ] Share-cost: split candidate → validasi SUM di client sebelum submit (UX), dropdown target
  cuma dinas aktif, submit sukses → baris asli hilang dari candidates, baris baru muncul di tempat
  lain (confirm queue milik dinas_target masing-masing, verifikasi lewat 6c kalau sudah ada).
- [ ] Non-TAB tak bisa akses ketiga fitur ini (kecuali current-reminder).
- [ ] `ng build`/lint bersih. Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: struktur tiga `features/` final, field response yang dikonfirmasi dari source, keputusan
lokasi service `current-reminder`. Update tracker §0 → Batch 6f ✅ (**Batch 6 tuntas — restrukturisasi
frontend selesai**). Ingatkan di laporan: langkah berikutnya adalah Batch 7 (finishing:
lint/dead-code/env-fail-fast/polish withTransaction) — TIDAK otomatis lanjut ke situ tanpa arahan baru.
