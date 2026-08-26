# PROMPT — Batch 3c: Reassignment Inisiator + Investigation

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§6 guardrail, §8 Batch 3).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 81 test yang sudah hijau.**
>
> **REUSE, JANGAN reinvent.** 3c pakai pola yang SUDAH terbukti di 3b:
> `db.withTransaction` + `SELECT ... FOR UPDATE` + ledger + audit + **rollback-audit via koneksi terpisah**
> (`logRollbackAudit`), plus modul 3a (`reassignmentRules`, `textValidation`, `mentionRules`) & `DirectoryProvider` (3b).
> Sumber: `rdt/backend/src/routes/reassignment.js` + `investigation.js` (port faithful).

## 0. Ekstrak helper komentar-pasangan (hindari duplikasi — arahan IT)

3b menaruh `postDescriptionComments` sebagai private di `ConfirmationService`. Investigation butuh
logika **nyaris identik** (reply ke root thread pasangan + notifikasi = mention∪dinas-target, minus author,
`filterMentionsToPair`). **Ekstrak jadi service bersama** (mis. `modules/repost/shared/pair-comment.service.ts`)
yang menerima `client` transaksi + pasangan + body, lalu dipakai 3b (refactor) DAN 3c. Jangan copy-paste.

## 0b. Rollback-audit bersama

`logRollbackAudit` (pola koneksi-terpisah dari 3b) juga dipakai kedua route 3c. Ekstrak/rapikan jadi
reusable (service atau method DatabaseService), jangan tulis ulang tiap route.

---

## PART 1 — Reassignment (resolusi DECLINED oleh inisiator)

Modul `modules/repost/reassignment/` (endpoint mount setara `/api/declined` lama).

### Endpoint
- **GET `:dinas`** — baris `dinas_inisiasi=:dinas AND status='DECLINED'`. Guard: **DinasAccessGuard** (3b).
- **POST `:id/resolve`** — body `{ action:'BORNE'|'REASSIGN', new_dinas_target?, note? }`. Transaksi tunggal.
- **POST `batch-resolve`** — body `{ items:[{id,action,new_dinas_target?}], note? }`. **Satu transaksi, all-or-nothing.**

### `resolveOneDeclined(client, user, {id, action, newTarget, note, ip})` — logika per-baris (dipakai single & batch)
- `action` bukan BORNE/REASSIGN → throw **400**.
- `SELECT ... FROM transactions WHERE id=$1 **FOR UPDATE**` (lock). Tak ada → **404**.
- **Otorisasi per-baris (BUKAN guard):** `user.role==='TAB'` ATAU `user.dinas == row.dinas_inisiasi` (case-insensitive);
  selain itu → **403** (`only the initiator dinas or TAB may resolve`). *(Tak bisa guard karena bergantung `dinas_inisiasi` baris yang baru diketahui setelah lock.)*
- `status != 'DECLINED'` → **409**.
- **BORNE** → `status='BORNE_BY_INITIATOR'`, decided_by/at, audit `BORNE_BY_INITIATOR`.
  **TANPA ledger** (inisiator nanggung sendiri, tak ada budget lintas-dinas) & **tanpa snapshot** (nilai dari DECLINE dipertahankan).
- **REASSIGN** → `validCodes` = `SELECT code FROM dinas WHERE is_active=true` → `buildValidCodeMap`;
  `validateReassignTarget(...)` (3a; **cap reassign_count=3** via `REASSIGN_CAP`); gagal → throw pakai `validation.httpStatus`.
  Lalu `UPDATE dinas_target=<new>, status='PENDING', reassigned_from=<old>, reassign_count+1, decided NULL, **periode_efektif=NULL**`; audit `REASSIGN`.
- `note` lewat `validateFreeText` (3a), disimpan di `audit_log.detail`.
- Throw pakai status yang sesuai (mapping ke HttpException/DomainError: 400/403/404/409). Caller-nya bungkus `withTransaction` + rollback-audit.

---

## PART 2 — Investigation (TAB assign "Ask TA")

Modul `modules/repost/investigation/`. **TAB-only** — pasang `@Roles('TAB')` + RolesGuard (Batch 2) di semua endpoint.
Baris `status='NEEDS_INVESTIGATION'` (Recipient literal "Ask TA", `dinas_target` null).

### Endpoint
- **GET `/`** — semua baris NEEDS_INVESTIGATION + konteks (join uploads), `ORDER BY created_at ASC`.
- **POST `:transactionId/assign`** — body `{ dinas_target, description? }`. Transaksi tunggal.
- **POST `assign-all`** — body `{ items:[{transaction_id,dinas_target}], description? }`.
  **Gate all-or-nothing:** kalau ADA item tanpa `transaction_id`/`dinas_target` → **400** (jangan proses sebagian). Satu transaksi.

### Logika assign (single & tiap item batch)
- `SELECT ... FOR UPDATE`. Tak ada → throw. `status != 'NEEDS_INVESTIGATION'` → throw.
- `validCodes` (is_active=true) → `validateReassignTarget(...)`; gagal → throw.
- **Langsung CONFIRMED (bukan PENDING) — assignment TAB itu final:**
  `UPDATE dinas_target=<new>, status='CONFIRMED', reassigned_from='Ask TA', decided_by/at`.
- **2 ledger entry** (sama seperti CONFIRM): DEBIT `<new target>`, CREDIT `dinas_inisiasi`, = nominal.
- audit `INVESTIGATION_RESOLVED` (`NEEDS_INVESTIGATION`→`CONFIRMED`, detail `{assigned_to, resolved_by, auto_confirmed:true}`).
- `description` → **pair-comment helper (§0)** pada pasangan (`dinas_inisiasi`, `<new target>`) yang BARU. Batch: satu komentar per pasangan distinct.
- **Tanpa snapshot periode_efektif** (kode lama tidak snapshot di jalur investigasi).

---

## Acceptance (HTTP nyata lawan rdt_dev + unit test; bersihkan data uji setelahnya)
- [ ] BORNE → `BORNE_BY_INITIATOR`, **nol ledger**, audit benar. REASSIGN → target baru (is_active), PENDING, reassign_count+1, periode_efektif NULL; **cap 3** → REASSIGN ke-4 ditolak (400).
- [ ] Otorisasi resolve: non-inisiator & non-TAB → **403**; status non-DECLINED → **409**; id tak ada → **404**.
- [ ] `batch-resolve` atomik: 1 valid + 1 invalid → gagal, **nol perubahan** (baris valid pun tak berubah).
- [ ] Investigation TAB-only: non-TAB → **403** di semua endpoint.
- [ ] assign → **CONFIRMED + tepat 2 ledger** (DEBIT target, CREDIT inisiasi); `reassigned_from='Ask TA'`; audit `INVESTIGATION_RESOLVED`.
- [ ] `assign-all` gate: ada item tanpa target → **400**, tak proses sebagian. Batch valid → semua CONFIRMED dalam 1 transaksi.
- [ ] Rollback-audit tetap tercatat walau transaksi utama gagal (koneksi terpisah).
- [ ] Helper pair-comment dipakai bersama 3b & 3c (bukan duplikasi). 81 test lama tetap hijau; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope
- Export/format TAB → Batch 4. Listing/thread komentar & notifikasi penuh, dashboard → Batch 5.
- `persist`/upload supersede → batch tersendiri nanti.

## Setelah selesai
Laporkan: struktur kedua modul + helper bersama, hasil tiap acceptance (khususnya BORNE-no-ledger, cap-3,
investigation→CONFIRMED+2 ledger, atomicity batch), konfirmasi 81 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3c ✅ (Batch 3 tuntas).
