# PROMPT — Batch 3a: Port Modul Aturan (rules, DB-independent)

> Tempel ke agent eksekutor. Rujukan: `rdt/docs/RENCANA_REWRITE_NESTJS.md` (§8 Batch 3).
> Backend lama `rdt/backend/` **JANGAN disentuh** — hanya sumber kode & test yang di-port.
> **Jangan pecahkan 6 test yang sudah hijau** (2 sanity + 4 parser).

## Konteks

Ini sub-batch pertama dari confirmation (dipecah 3a → 3b → 3c biar scope sempit). Pola sama seperti
parser Batch 1: **port unit murni & testable DULU**, biar pas 3b (confirmation core, zona transaksi)
building block-nya sudah terbukti benar lewat test. **3a TIDAK menyentuh DB, Express, atau route apa pun.**

Sumber: `rdt/backend/src/rules/`. Enam modul + enam file test-nya di `rdt/backend/test/`.

## Tugas: port 6 modul aturan (semua **fungsi murni**, TypeScript strict)

Port apa adanya (logika identik, dipecah rapi kalau perlu, tanpa flag-argument). Semua HARUS tetap
murni — **tidak ada** koneksi DB/HTTP/fetch; data eksternal (mis. directory karyawan) **diterima sebagai
parameter**, bukan diambil sendiri.

1. **`errorClassification.js`** → `classifyError(err)` + `CATEGORY` (KONFLIK_KONKURENSI / DATA_TIDAK_VALID /
   KONEKSI_TERPUTUS / LAINNYA, dari SQLSTATE PG & kode Node). Dipakai 3b buat lapor kategori saat ROLLBACK.
2. **`textValidation.js`** → `validateFreeText(value, { fieldLabel })` → `{ ok, value }` / `{ ok:false, error }`.
3. **`stateLabel.js`** → mapping state transaksi → label tampilan (baca file untuk kontrak persisnya).
4. **`reassignmentRules.js`** → `validateReassignTarget(...)`, `buildValidCodeMap(...)` (+ export lain bila ada).
   Validasi target reassign terhadap peta kode valid. **Ingat aturan `is_active`** (tracker §6): picker
   pakai kode aktif; TAB & kode nonaktif tidak boleh jadi target reassign umum.
5. **`periodEffective.js`** → `computeEffectivePeriod({ declaredPeriod, deadlineAt, latestTargetActionAt })`,
   `pickDeadline(perPairRow, defaultRow)`. Perhitungan periode efektif vs deadline (dipakai snapshot di 3b).
6. **`mentionRules.js`** → `extractMentionTokens(body)`, `resolveMentionedUserIds(body, directory)`,
   `filterMentionsToPair(userIds, directory, allowedDinasCodes)`. `directory` **selalu argumen**
   (bentuk `employee-directory.seed.json`: `{ user_id: { dinas, role, display_name } }`). Jaga privacy-fix
   `filterMentionsToPair` (mention tak boleh bocor ke pasangan lain; TAB boleh lihat semua).

## Penempatan (konvensi NestJS)

- Lintas-domain → `core/`: `errorClassification` (→ `core/errors/`), `textValidation` (→ `core/utils/` atau `core/validation/`).
- Domain repost → `modules/repost/rules/`: `reassignmentRules`, `periodEffective`, `mentionRules`, `stateLabel`.
- Logika inti tetap fungsi murni. Bila 3b/3c akan mengonsumsinya lewat DI, boleh dibungkus `@Injectable`
  tipis — **tapi jangan over-engineer** yang trivial (`stateLabel`, `errorClassification`) jadi service gemuk.
- Kalau butuh, copy `employee-directory.seed.json` ke project baru (dipakai fixture test; sumber prod di 3b).

## Port test → Jest (`.spec.ts`)

Port keenam file test ini apa adanya, sesuaikan import + tipe:
`reassignmentRules.test.js`, `periodEffective.test.js`, `mentionRules.test.js`, `textValidation.test.js`,
`stateLabel.test.js`, `errorClassification.test.js`. Ini acceptance-nya — **harus hijau, logika tak berubah**.

## Acceptance
- [ ] 6 modul ter-port sebagai fungsi murni (nol dependensi DB/Express/HTTP).
- [ ] 6 suite test aturan hijau di Jest (logika identik dengan versi lama).
- [ ] 6 test lama (2 sanity + 4 parser) **tetap hijau**.
- [ ] `npm run build` & `lint` bersih. `rdt/backend/` lama tak berubah.

## Di luar scope (JANGAN dikerjakan)
- Route confirmation / submit / reassignment / investigation → 3b & 3c.
- Transaksi, `FOR UPDATE`, snapshot ke DB, pembuatan komentar/notifikasi → 3b.
- Apa pun yang butuh koneksi DB.

## Setelah selesai
Laporkan: lokasi tiap modul, konfirmasi kemurnian (tak ada import DB/Express), hasil `npm test`
(jumlah suite/test hijau, termasuk 6 lama). Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 3a ✅.
