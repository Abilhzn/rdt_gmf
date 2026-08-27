# PROMPT — Batch 7b: Finishing Frontend (dead-code confirm, lint, minimal critical tests)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 7). Jalankan independen
> dari 7a (folder beda), boleh paralel. Backend & `auth/frontend/` **JANGAN diubah**.

## Konteks

Batch 6 (6a-6f) restrukturisasi frontend sudah selesai kodenya, tapi belum ada test otomatis sama
sekali di `rdt/frontend/` (dikonfirmasi — nol file `.spec.ts`/`.test.ts` di seluruh tree). Batch ini
BUKAN retrofit test-suite penuh (di luar scope/waktu) — cukup: (1) konfirmasi dead-code benar-benar
bersih, (2) lint 0 masalah, (3) tambah SEJUMLAH KECIL test buat logic paling kritis yang murni
(bukan komponen UI penuh — itu di-cover Batch 8 verifikasi manual).

## Tugas

### 1. Konfirmasi dead-code sudah bersih (bukan tugas baru — verifikasi klaim Batch 6)
Laporan 6b-6f bilang "file lama dipertahankan sementara lalu dihapus begitu konsumen terakhir
termigrasi" — konfirmasi ini genuinely tuntas:
- `grep`/search referensi ke nama file lama yang disebut di laporan Batch 6 (`transaction.service.ts`
  versi lama, `export-batch.service.ts` lama, `confirmation.service.ts` versi lama) — pastikan
  benar-benar hilang, tak ada import yang nyasar ke path yang sudah tak ada.
- List `rdt/frontend/rdt/` top-level — pastikan cuma `core/`, `features/`, `services/` (sisa 4 file
  lintas-fitur sesuai laporan: dinas/mention/modal/notifications), `shared/`, `shell/`, `assets/`,
  routing/module files. Tak ada folder fitur lama (`admin/`,`confirm/`,`home/`,dst) yang tersisa.

### 2. Lint
`ng lint` (atau `eslint` langsung kalau `ng lint` tak dikonfigurasi) → 0 warning, 0 error di seluruh
`rdt/frontend/rdt/`. Perbaiki yang ditemukan — perubahan minimal, jangan refactor ekstra di luar lint.

### 3. Test minimal — logic murni paling kritis (bukan komponen, bukan HTTP)

Prioritas (kalau waktu terbatas, urutan ini):
1. **Share-cost SUM validation** (`components/split-form.component.ts` dari 6f) — fungsi/logic yang
   ngecek total nominal split vs nominal asli. Test: sum pas → valid; sum kurang/lebih (termasuk
   kasus sen/desimal) → invalid. Ini logic yang paling gampang salah & paling penting (mencerminkan
   validasi sen-integer di backend `share-cost.service.ts` 5.5b — pastikan client-side check pakai
   presisi yang sama, bukan float naive, biar tak ada kasus client bilang "valid" tapi server tolak).
2. **Admin merge vs replace-all distinction** (6f) — kalau ada logic UI yang membedakan dua mode ini
   (bukan cuma tampilan tapi actual state handling), test itu.
3. **`matchesAllColumnFilters`** (`shared/multi-value-filter.component.ts`, dipakai lintas beberapa
   fitur) — fungsi murni, gampang ditest, dipakai di banyak tempat jadi worth di-lock lewat test.

Kalau ada fungsi murni lain yang eksekutor anggap high-risk (dipakai lintas fitur, logic non-trivial),
boleh ditambah — tapi jangan meluas ke testing komponen Angular penuh (TestBed/fixture) di batch ini,
itu investasi besar di luar scope "finishing".

## Acceptance
- [ ] Dead-code lama terkonfirmasi bersih (laporkan hasil grep, bukan cuma re-klaim tanpa bukti).
- [ ] `ng lint` 0 warning, 0 error.
- [ ] Minimal 1-3 test file baru untuk logic murni kritis (item 3), semua hijau.
- [ ] `ng build` tetap bersih setelah semua perubahan.
- [ ] Backend & `auth/frontend/` tak berubah.

## Setelah selesai
Laporkan: hasil konfirmasi dead-code (apa yang dicek, apa hasilnya), hasil lint sebelum/sesudah,
daftar test baru + apa yang mereka kunci. Update `RENCANA_REWRITE_NESTJS.md` §0 → tandai progres
Batch 7 (frontend) di §8. **Jangan tandai Batch 6/7 penuh ✅** — itu nunggu Batch 8.
