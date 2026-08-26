# PROMPT — Verifikasi Batch 3.5b Lawan DB Beneran (self-service)

> Tempel ke agent eksekutor. Kamu punya akses shell + kode di mesin ini — pakai itu, JANGAN
> nebak field/header/route. Kalau request gagal, BACA controller/DTO terkait dulu buat tau
> bentuk yang benar, baru coba lagi. Ini murni verifikasi (acceptance check), BUKAN batch baru —
> tidak ada kode baru yang perlu ditulis kecuali kalau verifikasi ini nemu bug nyata di 3.5b.

## Tujuan

Batch 3.5b (persist) sejauh ini cuma diverifikasi lewat unit test (mocked pg) — belum lewat HTTP
nyata ke Postgres beneran. Mocked test bisa lolos walau ada nama kolom SQL yang salah (mock tidak
memvalidasi terhadap skema asli). Tugas ini: buktikan alur **upload → persist → confirm** jalan
end-to-end lawan Postgres nyata, dari database kosong.

## Setup (pakai DB TERPISAH, jangan sentuh `rdt_dev`)

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE rdt_persist_test;"
# arahkan .env (DB_NAME) sementara ke rdt_persist_test
npm run migrate
npm run start   # biarkan jalan di background/terminal terpisah
```

## Langkah verifikasi

1. **Cek `/health`** → harus `{status:'ok', db:'ok'}`.
2. **Cari tahu bentuk request yang benar** dengan membaca kode (jangan menebak):
   - `src/modules/repost/upload/upload.controller.ts` + DTO-nya → field apa saja yang wajib buat `POST repost/upload/parse` (sudah ketahuan butuh `uploaderDinas` sebagai form field, bukan dari header).
   - `src/modules/repost/persist/persist.controller.ts` + `dto/persist-upload.dto.ts` → field `POST repost/persist`.
   - `src/core/security/dev-mock-identity.provider.ts` → header identity yang dibaca (`x-dev-user-id`, `x-dev-dinas`, `x-dev-role` — role **case-sensitive**, `'TAB'`/`'PIC'` dst, cek `DinasAccessGuard`/`RolesGuard` buat nilai yang valid).
   - `src/modules/repost/confirmation/confirmation.controller.ts` → bentuk body `POST repost/confirmation/:dinas/submit`.
3. **Parse** file `rdt/contoh_input/06. DT TJ - Jun 2026.xlsx` lewat `POST repost/upload/parse` → **harus 490 rows** (angka acceptance Batch 1).
4. **Persist** hasil parse itu lewat `POST repost/persist` (kirim `rows`, `original_filename`, `file`, dinas uploader TJ).
   - Kalau error 500/400 di sini: baca pesan errornya. Kalau errornya dari Postgres (mis. `column "x" does not exist`), itu bug nyata di `persist.service.ts` (`INSERT_COLUMNS`) — **cocokkan ke `rdt/backend-nest/sql/schema.sql` + migrations**, perbaiki nama kolom yang salah, lalu ulangi dari langkah 3. Kalau error validasi (400) karena field kurang, perbaiki request-nya (bukan kode).
5. **Verifikasi lewat DB langsung** (`psql`): jumlah & isi baris `rdt.transactions` untuk `upload_id` hasil langkah 4 — cocok dengan hasil parse (490 baris, breakdown status sesuai Batch 1: TE 84.36 / TMM 473933.51 / TA 1653.24 PENDING, 3 baris NEEDS_INVESTIGATION = 40393.29), dan kolom (`account`, `ref_doc`, `sheet_name`, `raw_row_index`, `category`, dst) **terisi, bukan semua NULL**.
6. **Confirm satu baris**: ambil satu `id` PENDING + `dinas_target`-nya dari langkah 5, panggil `POST repost/confirmation/:dinas_target/submit` dengan identity dinas target itu, `claim:"YA"`.
7. **Verifikasi ledger**: `SELECT * FROM rdt.ledger_entries WHERE transaction_id=<id>` → harus **tepat 2 baris** (DEBIT dinas_target, CREDIT dinas_inisiasi TJ, = nominal baris itu).
8. (Opsional tapi bagus) Uji **supersede**: ulangi langkah 3-4 dengan file TJ yang sama (dinas+periode sama) → upload lama harus `SUPERSEDED`, upload baru `ACTIVE`.
9. **Bersih-bersih**: stop app, kembalikan `.env` ke `DB_NAME` semula, `psql -c "DROP DATABASE rdt_persist_test;"`.

## Kalau nemu bug nyata (bukan salah request)

Perbaiki di `persist.service.ts` (atau file terkait), jalankan ulang unit test (`npm test`, pastikan
137 test lama tetap hijau setelah perbaikan), lalu ulangi verifikasi HTTP dari langkah 3.

## Laporkan

- Hasil tiap langkah 1-8 (termasuk field/header final yang benar dipakai — biar didokumentasikan).
- Kalau ada bug yang diperbaiki: file mana, apa yang salah, apa fix-nya, konfirmasi 137 test lama tetap hijau.
- Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3.5b jadi ✅ **penuh** (real-DB run terverifikasi, bukan cuma unit test) HANYA setelah langkah 1-7 semua lolos.
