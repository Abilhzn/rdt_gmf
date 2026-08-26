# PROMPT — Batch 5.5a: Period Deadlines (fitur baru, kelewat dari rencana awal)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 5.5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 212 test yang sudah hijau.**
> Sumber: `rdt/backend/src/routes/periodDeadlines.js` (port faithful — 8 endpoint asli; catatan: ada
> endpoint `POST /override-reevaluate` yang SUDAH DIHAPUS di kode lama sendiri — jangan diporting,
> itu bukan kelalaian, memang sengaja ditiadakan).
> Reuse: `buildValidCodeMap` (3a), `currentAutoPeriode` (3a), `withTransaction`+`RollbackAuditService`
> (3c). **Reuse `BLOCKING_STATUSES`/`ATTACHABLE_STATUSES` dari `export` (4a)** — beda dari dashboard
> (5b) yang konstantanya BEDA nilai, di sini nilainya **identik** (`BLOCKING=[PENDING,DECLINED,
> NEEDS_REVIEW]`, `ATTACHABLE=[CONFIRMED,BORNE_BY_INITIATOR]`), jadi ini kasus DRY yang tepat —
> jangan redeclare, import dari module export.

## Konteks

TAB set deadline konfirmasi **per pasangan × periode**, dikonsumsi `snapshotPeriodeEfektif` (3b)
lewat `pickDeadline` (3a) saat CONFIRM/DECLINE. Ini murni CRUD tabel deadline-nya. `PERIODE_RE =
/^\d{4}-\d{2}$/`.

**Gate akses**: SEMUA endpoint **TAB-only**, KECUALI **`GET current-reminder`** (semua user login —
reminder banner harus tampil di halaman repost dinas mana pun).

## Helper bersama

**`validatePeriodAndDeadline({ periode, deadline_at })`** → cek `periode` match `PERIODE_RE`,
`deadline_at` parse jadi `Date` valid — dipakai `POST /` dan `POST /default`.

## 8 Endpoint (`modules/period-deadlines/`)

1. **`GET period-deadlines/current-reminder`** (semua user) — `periode = currentAutoPeriode()` (3a).
   `SELECT deadline_at FROM period_default_deadlines WHERE periode=$1`. Response
   `{ periode, deadline_at: row?.deadline_at ?? null }`.

2. **`GET period-deadlines/`** (TAB) — query opsional `?dinas_inisiasi=&dinas_target=` (filter dinamis,
   boleh salah satu/dua/tanpa). `SELECT * FROM period_deadlines [WHERE ...] ORDER BY periode DESC,
   dinas_inisiasi, dinas_target`. Response `{ deadlines: [...] }`.

3. **`POST period-deadlines/`** (TAB) — body `{ dinas_inisiasi, dinas_target, periode, deadline_at }`.
   `dinas_inisiasi`/`dinas_target` wajib → 400. `validatePeriodAndDeadline` → 400. Validasi **dinas
   aktif**: `SELECT code FROM dinas WHERE is_active=true` → `buildValidCodeMap` (3a) → resolve kedua
   kode (case-insensitive via map, ambil kode kanonik); tak dikenal → 400 masing-masing pesan beda
   utk inisiasi vs target. **Upsert** (`ON CONFLICT (dinas_inisiasi,dinas_target,periode) DO UPDATE
   SET deadline_at, set_by_user_id, updated_at=now()`) `RETURNING *`. Response `{ deadline: row }`.
   Single statement, tak perlu `withTransaction`.

4. **`GET period-deadlines/default`** (TAB) — `SELECT * FROM period_default_deadlines ORDER BY periode DESC`.
   Response `{ deadlines: [...] }`.

5. **`POST period-deadlines/default`** (TAB) — body `{ periode, deadline_at }`. `validatePeriodAndDeadline`
   → 400. **Transaksi (`withTransaction`)**:
   - **Upsert default**: `INSERT period_default_deadlines(periode, deadline_at, set_by_user_id) ...
     ON CONFLICT (periode) DO UPDATE SET deadline_at, set_by_user_id, updated_at=now() RETURNING *`.
   - **Sweep** ke pasangan yang SUDAH punya transaksi non-terminal di periode itu, **dalam transaksi
     yang sama** (no partial-success): `INSERT period_deadlines SELECT DISTINCT t.dinas_inisiasi,
     t.dinas_target, $periode, $deadline_at::timestamptz, $userId FROM transactions t JOIN uploads u
     ON u.id=t.upload_id WHERE u.period=$periode AND t.dinas_target IS NOT NULL AND
     t.status_konfirmasi=ANY(BLOCKING_STATUSES) ON CONFLICT (dinas_inisiasi,dinas_target,periode) DO
     UPDATE SET deadline_at, set_by_user_id, updated_at=now() RETURNING *`.
     ⚠️ **`::timestamptz` cast eksplisit WAJIB dipertahankan** — tanpa itu Postgres gagal infer tipe
     parameter di posisi SELECT-list ini (beda dari posisi lain yang infer otomatis dari kolom tabel).
   - Response `{ deadline: defaultRow, swept: sweptRows }`. Gagal → rollback + `RollbackAuditService` (3c).

6. **`DELETE period-deadlines/default/:periode`** (TAB) — validasi `PERIODE_RE` → 400. Lookup
   `deadline_at` existing → tak ada → **404**. **`deadline_at <= now()` → 400** ("sudah lewat — tidak
   bisa dihapus, cuma bisa dihapus sebelum waktunya") — **hapus HANYA kalau masih di masa depan**
   (jaga integritas histori: pasangan yang sudah snapshot `periode_efektif` tetap terjaga, tapi baris
   deadline yang sudah lewat dipertahankan sebagai jejak audit). Baru `DELETE`. Response `{ periode }`.

7. **`GET period-deadlines/overdue?periode=YYYY-MM`** (TAB) — validasi periode. `findOverduePairs`:
   pasangan `export_batch_id IS NULL`, `upload.period=$periode`, `dinas_target IS NOT NULL`,
   `GROUP BY dinas_inisiasi,dinas_target HAVING COUNT(*) = COUNT(*) FILTER (status=ANY(ATTACHABLE))
   AND MAX(periode_efektif) IS NOT NULL AND MAX(periode_efektif) <> $periode` (100% resolved TAPI
   snapshot bergeser dari periode ini). **Informational only — tak ada aksi un-stick**, list ini
   permanen sampai TAB proses lewat export. Response `{ periode, overdue: [{dinas_inisiasi,
   dinas_target, total, periode_efektif}] }`.

8. **`GET period-deadlines/active-pairs?periode=YYYY-MM`** (TAB) — validasi periode. Pasangan
   `export_batch_id IS NULL`, `upload.period=$periode`, `dinas_target IS NOT NULL`, `GROUP BY pair
   HAVING COUNT(*) FILTER (status=ANY(BLOCKING)) > 0`. Response `{ periode, active: [{dinas_inisiasi,
   dinas_target, total, open_count}] }`. Endpoint terpisah dari #7 (bukan digabung satu query) —
   port apa adanya, biar tetap single-purpose.

## Acceptance (HTTP nyata lawan `rdt_dev`; data uji dibersihkan balik ke seed setelahnya)
- [ ] `current-reminder` bisa diakses non-TAB (PIC apapun); TAB-only endpoint lain → non-TAB 403.
- [ ] `POST /` upsert: set deadline pasangan baru → row baru; set lagi triple yang sama dengan
  `deadline_at` beda → **UPDATE** row yang sama (bukan duplikat), `updated_at` berubah.
- [ ] `POST /` dengan `dinas_inisiasi`/`dinas_target` yang tak aktif/tak dikenal → 400.
- [ ] `POST /default` → default ter-upsert **dan** sweep ke pasangan existing yang masih
  PENDING/DECLINED/NEEDS_REVIEW di periode itu (pasangan yang sudah CONFIRMED/tanpa transaksi di
  periode itu **tidak** ikut ter-sweep); dua-duanya dalam satu transaksi (paksa gagal di sweep →
  default pun ikut rollback).
- [ ] `DELETE /default/:periode` untuk deadline **masa depan** → berhasil, row hilang. Untuk deadline
  **sudah lewat** → 400, row tetap ada. Untuk periode tak ada row → 404.
- [ ] `overdue`: pasangan 100% resolved dengan `periode_efektif` yang sudah snapshot beda dari
  periode declared → muncul. Pasangan yang masih ada PENDING → **tidak** muncul (bukan overdue,
  belum "100% resolved").
- [ ] `active-pairs`: pasangan dengan sisa PENDING/DECLINED/NEEDS_REVIEW → muncul dengan `open_count`
  benar; pasangan 100% resolved → tidak muncul.
- [ ] **212 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance (khususnya upsert-vs-duplicate, sweep-transaksional,
delete-hanya-masa-depan), konfirmasi 212 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 5.5a ✅.
