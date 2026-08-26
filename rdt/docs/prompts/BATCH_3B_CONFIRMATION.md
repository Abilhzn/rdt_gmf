# PROMPT — Batch 3b: Confirmation Core 🔴 (zona transaksi)

> Tempel ke agent eksekutor. Rujukan: `rdt/docs/RENCANA_REWRITE_NESTJS.md` (§6 guardrail, §8 Batch 3).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan test yang sudah hijau (66).**
> Modul aturan dari 3a (`reassignmentRules`, `periodEffective`, `mentionRules`, `errorClassification`,
> `textValidation`) **dipakai di sini — konsumsi, jangan tulis ulang.**
>
> 🔴 **Ini batch paling kritis. Prioritas #1 = korektnya transaksi finansial, bukan kecepatan.**
> Sumber: `rdt/backend/src/routes/confirmation.js` (port faithful). Endpoint di-mount di `repost/confirmation`.

## 0. DinasAccessGuard (implementasi nyata — Batch 0 baru skeleton)

Aturan (dari `authorization.test.js`, port test-nya):
- Tidak ada identity → **401**.
- `role === 'TAB'` → boleh **semua** dinas (termasuk `Corp`).
- Selain itu: `identity.dinas` == param `:dinas` (case-insensitive) → boleh; kalau beda → **403**.
- `Corp` tidak punya PIC → praktis hanya TAB yang lolos (konsekuensi aturan di atas, bukan cabang khusus).
- **Identity HANYA dari IdentityProvider (Batch 0). JANGAN pernah percaya `dinas`/`role` dari body/query request.**

Pasang guard ini di kedua endpoint di bawah (param `:dinas`).

## 1. GET `repost/confirmation/:dinas` — antrian PENDING

- Query: baris `rdt.transactions` `WHERE dinas_target=:dinas AND status_konfirmasi='PENDING'`,
  JOIN `rdt.uploads` untuk `original_filename` (buat tombol "download original" per upload).
- **Breadcrumb chain**: untuk baris `reassign_count>0`, ambil `audit_log` action `REASSIGN`/`REJECT_REDIRECT`
  (`ORDER BY id ASC`), susun `chain = [dinas_inisiasi, ...hop perantara, dinas]`. (Baca kode lama buat pola persisnya.)
- Read-only, tak perlu transaksi.

## 2. POST `repost/confirmation/:dinas/submit` — batch CONFIRM/DECLINE 🔴

Body: `{ decisions: [{ id, claim: 'YA' | 'TIDAK', redirect_to? }], description? }`.
Pra-transaksi: `validateFreeText(description)` (3a) → invalid = 400, jangan buka transaksi.

### Bungkus SEMUANYA dalam `db.withTransaction(...)` (atomik, all-or-nothing)

Untuk **tiap** decision, berurutan, di dalam transaksi:

1. **Lock baris:**
   `SELECT t.id, t.status_konfirmasi, t.dinas_target, t.dinas_inisiasi, t.nominal, t.account, t.remark, t.ref_doc, t.reassign_count, u.period FROM rdt.transactions t JOIN rdt.uploads u ON u.id=t.upload_id WHERE t.id=$1 **FOR UPDATE OF t**`
   (`FOR UPDATE OF t` = kunci baris transactions saja, bukan uploads. WAJIB pakai client transaksi.)
2. **Guard (throw → seluruh batch rollback):** tidak ketemu → throw; `status != 'PENDING'` → throw;
   `dinas_target != :dinas` → throw.
3. **`claim==='YA'` (CONFIRM):**
   - `UPDATE transactions SET status_konfirmasi='CONFIRMED', decided_by_user_id=:user, decided_at=now()`.
   - **2 ledger entry** (inti finansial): `INSERT ledger_entries(transaction_id, dinas_code, direction, amount)` →
     (`:dinas`,`'DEBIT'`,`nominal`) DAN (`dinas_inisiasi`,`'CREDIT'`,`nominal`).
   - `INSERT audit_log` action `CONFIRM` (status_before PENDING → after CONFIRMED, detail `{dinas, amount}`, ip).
   - **`snapshotPeriodeEfektif`** (lihat §3).
4. **`claim==='TIDAK'` + `redirect_to` (REJECT_REDIRECT):**
   - Lazy-load `validCodes` sekali: `SELECT code FROM rdt.dinas WHERE is_active=true` → `buildValidCodeMap` (3a).
     (**is_active=true** — target reassign hanya dinas aktif; TAB/nonaktif tak boleh. Tracker §6.)
   - `validateReassignTarget({ newTarget: redirect_to, validCodes, dinasInisiasi, currentDinasTarget, reassignCount })` (3a);
     invalid → throw.
   - `UPDATE transactions SET dinas_target=<newTargetUpper>, status_konfirmasi='PENDING', reassigned_from=<old target>,
     reassign_count=reassign_count+1, decided_by_user_id=NULL, decided_at=NULL, **periode_efektif=NULL**`.
   - `INSERT audit_log` action `REJECT_REDIRECT` (detail `{rejected_by, from_dinas, to_dinas, reassign_count}`).
   - **TIDAK ada snapshot** (baris mulai episode baru di pasangan lain).
5. **`claim==='TIDAK'` tanpa `redirect_to` (DECLINE):**
   - `UPDATE transactions SET status_konfirmasi='DECLINED', decided_by_user_id=:user, decided_at=now()`.
   - `INSERT audit_log` action `DECLINE`.
   - **`snapshotPeriodeEfektif`** (lihat §3).
6. else → throw `invalid claim`.

### Setelah loop, MASIH di transaksi: description → komentar + notifikasi

Kalau `description` ada: load directory (§4), untuk tiap `dinas_inisiasi` di batch:
- Cari root comment pasangan (`comments` where pair `(dinas_inisiasi, :dinas)`, `parent_comment_id IS NULL`, terbaru) →
  `INSERT comments` sebagai **reply** (fallback transaction_id kalau belum ada thread).
- Penerima notif = `filterMentionsToPair(resolveMentionedUserIds(desc, directory), directory, [dinas_inisiasi, dinas])` (3a)
  **∪** semua user ber-`dinas == dinas_inisiasi`, **minus** author. `INSERT notifications(recipient_user_id, comment_id)`.
- (Jaga privacy-fix mention: teks broadcast yang sama tak boleh bocor ke pasangan lain.)

Lalu `COMMIT`. Sukses → balikin `{ declined, redirected }` (ikut konvensi ApiResponse baru).

### 🔴 Penanganan gagal (paling gampang salah)

`withTransaction` sudah ROLLBACK otomatis saat ada throw. Di `catch` service, **SETELAH** rollback:
- `classifyError(err)` (3a) → kategori.
- **Tulis rollback-audit lewat koneksi TERPISAH** (`db.query(...)`, autocommit, BUKAN client transaksi yang sudah rollback)
  supaya entry audit rollback **tidak ikut ter-rollback**. (Di kode lama ini `logRollbackAudit` dipanggil setelah ROLLBACK.)
- Throw domain exception yang **membawa `error_category`**; exception filter global menyertakannya di respons (500).

## 3. snapshotPeriodeEfektif (pakai periodEffective dari 3a)

`SELECT deadline_at FROM period_deadlines WHERE (dinas_inisiasi,dinas_target,periode)` (override per-pasangan) +
`SELECT deadline_at FROM period_default_deadlines WHERE periode` (default) → `pickDeadline(...)` →
`computeEffectivePeriod({ declaredPeriod, deadlineAt, latestTargetActionAt: new Date() })` →
`UPDATE transactions SET periode_efektif=$1`. Skip kalau `declaredPeriod` kosong. **Hanya untuk CONFIRM & DECLINE.**

## 4. Directory (buat mention/notifikasi)

Butuh directory karyawan `{ user_id: { dinas, role, display_name } }`. Buat `DirectoryService`:
dev baca `employee-directory.seed.json` (copy kalau belum ada); prod dari OCX (seam saja, seperti IdentityProvider).

## Acceptance (uji lewat HTTP nyata lawan rdt_dev + unit test)
- [ ] Guard: PIC akses dinas sendiri ✅; PIC akses dinas lain → 403; TAB akses dinas apa pun (termasuk Corp) ✅; tanpa identity → 401. (port test `authorization.test.js` bagian DinasAccess.)
- [ ] CONFIRM 1 baris → status CONFIRMED + **tepat 2 ledger entry** (DEBIT target, CREDIT inisiasi, = nominal) + audit CONFIRM + periode_efektif terisi.
- [ ] DECLINE → DECLINED + audit + snapshot. REJECT_REDIRECT → dinas_target baru, PENDING, reassign_count+1, periode_efektif NULL, audit REJECT_REDIRECT, TANPA ledger.
- [ ] **Atomicity 🔴:** batch berisi 1 decision valid + 1 invalid (mis. id tak PENDING) → **500, TIDAK ADA** perubahan tersimpan (baris valid pun tak berubah, tak ada ledger nyangkut). Respons memuat `error_category`.
- [ ] **Rollback-audit** tetap tercatat di `audit_log` walau transaksi utama rollback.
- [ ] description → 1 reply comment per dinas_inisiasi + notifikasi ke PIC inisiasi ∪ mention (tanpa bocor antar-pasangan).
- [ ] Data uji dibersihkan balik ke seed. 66 test lama tetap hijau. build/lint bersih. `rdt/backend/` tak berubah.

## Di luar scope (→ batch lain)
- Flow inisiator: Tanggung Sendiri / Ajukan Ulang / reassign penuh → **3c**. `investigation.js` → **3c**.
- Endpoint listing/thread komentar & notifikasi penuh → **Batch 5** (di sini cukup *pembuatan* yang kepicu submit).
- Export/format TAB → Batch 4. Dashboard → Batch 5.

## Setelah selesai
Laporkan: struktur `repost/confirmation` + `DinasAccessGuard`, hasil tiap acceptance (khususnya **bukti atomicity**
& rollback-audit), konfirmasi 66 test lama hijau. Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3b ✅.
