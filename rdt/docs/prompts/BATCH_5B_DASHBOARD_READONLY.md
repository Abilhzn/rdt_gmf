# PROMPT — Batch 5b: Dashboard — Baca-saja (summary / kpis / rollup / breakdown / badge)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 178 test yang sudah hijau.**
> Sumber: `rdt/backend/src/routes/dashboard.js` (port faithful — HANYA bagian baca-saja di sini).
> Reuse: `deriveStateLabel` (3a), `DirectoryProvider` (3b). **Tak ada tulis DB di batch ini.**
>
> ⚠️ Logika di sini rumit & penuh aturan halus (chain-tracking, period-majority, visibility-cutoff).
> **Port apa adanya, jangan "disederhanakan"** — tiap aturan di bawah punya alasan bisnis, port
> yang keliatan "aneh"/redundant biasanya sengaja begitu (lihat komentar di kode sumber untuk konteks).

## Konstanta (BARU, khusus dashboard — JANGAN reuse BLOCKING/ATTACHABLE_STATUSES dari `export`,
beda semantik meski `RESOLVED_STATUSES` kebetulan sama isinya dengan `ATTACHABLE_STATUSES`)

```
RESOLVED_STATUSES = ['CONFIRMED', 'BORNE_BY_INITIATOR']
ACTIONABLE_STATUSES = ['PENDING', 'CONFIRMED', 'DECLINED', 'BORNE_BY_INITIATOR']  // EXCLUDED/NEEDS_REVIEW/NEEDS_INVESTIGATION di luar ini
OPEN_STATUSES = ['PENDING', 'DECLINED']
```

## Helper bersama (buat di `modules/dashboard/shared/` — akan DIPAKAI LAGI di 5c, jangan taruh privat)

- **`fetchReassignChainMap(client, transactionIds)`** — `SELECT transaction_id, detail FROM audit_log
  WHERE transaction_id=ANY($1) AND action IN ('REASSIGN','REJECT_REDIRECT') ORDER BY transaction_id, id ASC`
  → `{ [txnId]: [from_dinas, from_dinas, ...] }` (urut kronologis, dedup berurutan).
- **`fetchReplyCounts(client, transactionIds)`** — `SELECT transaction_id, COUNT(*) FROM comments
  WHERE transaction_id=ANY($1) GROUP BY transaction_id` → map.
- **`fetchInvestigationCounts(client, initiatorDinas|null)`** — baris `NEEDS_INVESTIGATION` (opsional
  filter `dinas_inisiasi`), agregasi per `dinas_inisiasi` → `{dinas, target_dinas:'INVESTIGATION',
  total, resolved:0, percent:0, declined_pending_action:0, reply_count}` (sentinel — dinas_target
  literal `'INVESTIGATION'`, tak pernah nabrak kode dinas asli).

## `buildChainAwareProgress(client, { initiatorDinas, groupBy })` — jantung endpoint ini

`groupBy: 'target'` (view personal PIC, `initiatorDinas` diisi) VS `'pair'` (view global TAB,
`initiatorDinas=null`, ATAU breakdown satu dinas — lihat endpoint #5).

1. Query transaksi `dinas_target IS NOT NULL AND status_konfirmasi=ANY(ACTIONABLE)` (+filter
   `dinas_inisiasi` kalau `initiatorDinas` diisi), JOIN `uploads` (`period AS declared_period`), plus `periode_efektif`.
2. `chainMap` dari `fetchReassignChainMap` (hanya utk `reassign_count>0`), `replyCounts` dari `fetchReplyCounts`.
3. **Key grouping**: `originalTarget = chain[0] ?? dinas_target` (target PERTAMA sebelum reassign apa
   pun, bukan target sekarang). `groupBy==='pair'` → key `${dinas_inisiasi} ${originalTarget}`; `'target'` → key `originalTarget`.
   `fullChain = [dinas_inisiasi, ...chain, dinas_target]` (breadcrumb transaksi ini).
4. **Akumulasi per key** (`total`, `resolved`, `pending`, `declined_pending_action`, `reply_count`,
   `batchIds:Set`, `hasUnbatchedResolved:bool`, `periodCounts:{period:count}`, `maxPeriodeEfektif`,
   `chain` + `chainConsistent`): kalau baris `resolved` → `export_batch_id` ada masuk `batchIds`, kalau
   tak ada → `hasUnbatchedResolved=true`. `chainConsistent=false` kalau ada transaksi dalam grup yang
   `fullChain`-nya beda dari member pertama (breadcrumb cuma ditampilkan kalau SEMUA anggota grup sepakat jalur yang sama).
5. **Visibility cutoff**: buang key dari hasil HANYA kalau `total===resolved && !hasUnbatchedResolved &&
   batchIds.size>0` (100% resolved DAN semua sudah ter-subdoc) — pasangan yang cuma sebagian
   ter-repost (multi-subdoc-over-time) **tetap tampil**.
6. Per key yang lolos: `subdocNumbers` dari `export_subdocs` (via `batchIds`, kalau `hasUnbatchedResolved`
   → `[]`), `declaredPeriod` = periode ter-mayoritas (`periodCounts` — modus, bukan terbaru),
   `overdue = declaredPeriod && maxPeriodeEfektif && maxPeriodeEfektif !== declaredPeriod`,
   `percent = round(resolved/total*1000)/10`, `open=pending`, `state_label = deriveStateLabel({pendingCount:pending, targetDinas, subdocNumbers})`.
   Shape: `groupBy==='pair'` → `{dinas:dinas_inisiasi, target_dinas:target, ...}`; `'target'` → `{dinas:target, ...}`.
7. Tambahkan investigation pseudo-card(s): `groupBy==='pair'` → semua row dari `fetchInvestigationCounts(client,null)`
   (global, TIDAK difilter — endpoint #5 breakdown yang filter belakangan); `groupBy==='target'` → **satu**
   pseudo-card `{dinas:'INVESTIGATION', total, resolved:0, percent:0, declined_pending_action:0, reply_count}`
   dari `fetchInvestigationCounts(client, initiatorDinas)` (kalau ada).

## `buildNeedToConfirmProgress(client, targetDinasCodes, includeInvestigation)`

Beda dari di atas: **grouping by CURRENT `dinas_target`** (bukan original), scope `export_batch_id IS NULL`.
`needToConfirmTargetCodes(myDinas, isTabStaff)` = `isTabStaff ? [myDinas,'Corp'] : [myDinas]` (uppercase) —
**`TA` TIDAK termasuk** meski mirip TAB, TA punya PIC sendiri. Akumulasi mirip di atas (`declared`/`maxPeriodeEfektif`
→ `overdue`), `chain` ditampilkan kalau semua member sepakat **dan** `chain.length>2` (beda dari
`buildChainAwareProgress` yang tanpa syarat panjang). `includeInvestigation` (true hanya dari `/summary`
saat caller TAB) → append `fetchInvestigationCounts(client, null)`.

## `fetchNeedToConfirmDinas(client, targetDinasCodes, includeInvestigation)` — versi murah utk badge
`SELECT DISTINCT dinas_inisiasi FROM transactions WHERE UPPER(dinas_target)=ANY($1) AND status=ANY(ACTIONABLE)
AND export_batch_id IS NULL`. `includeInvestigation` → tambah `'INVESTIGATION'` ke list kalau ada baris NEEDS_INVESTIGATION apa pun.

---

## Endpoint (`modules/dashboard/`, guard = identity biasa kecuali disebut TAB-only)

1. **`GET dashboard/summary`** — `as_initiator` = `isTabStaff ? buildChainAwareProgress(null,'pair') :
   buildChainAwareProgress(myDinas,'target')`; `need_to_confirm = buildNeedToConfirmProgress(needToConfirmTargetCodes(...), isTabStaff)`.
   Response `{ own_dinas, as_initiator, need_to_confirm, is_global_view: isTabStaff }`.

2. **`GET dashboard/need-to-confirm-count`** — `{ count: fetchNeedToConfirmDinas(...).length }`.

3. **`GET dashboard/kpis`** — **role-aware shape berbeda total** (bukan superset):
   - **Non-TAB**: satu query `COUNT(*)`, `SUM(nominal)`, `COUNT(*) FILTER (status=ANY(OPEN))`,
     `COUNT(DISTINCT dinas_target)` `WHERE dinas_inisiasi=myDinas AND dinas_target IS NOT NULL AND status=ANY(ACTIONABLE)`
     → `{is_global_view:false, total_transaksi, total_nilai, pasangan_count, open_count, resolved_count:total-open_count}`.
   - **TAB**: 5 query paralel (`Promise.all`) — dinas aktif (`COUNT DISTINCT dinas_inisiasi`), total transaksi,
     butuh investigasi, **waiting_to_repost** (pasangan `export_batch_id IS NULL` yang nol
     `PENDING/DECLINED/NEEDS_REVIEW` DAN >0 `RESOLVED` — port query `HAVING` persis), reposted
     (`COUNT WHERE subdoc_id IS NOT NULL`) → `{is_global_view:true, dinas_aktif, total_transaksi, butuh_investigasi, waiting_to_repost, reposted}`.

4. **`GET dashboard/per-dinas-rollup`** — **TAB-only**. `GROUP BY dinas_inisiasi` (SEMUA pasangan dinas
   itu dijumlah jadi satu baris, beda dari `buildChainAwareProgress` yang per-pasangan): `total,
   confirmed(RESOLVED), open(PENDING), declined`, `ORDER BY open DESC, dinas ASC`. Per baris, hitung
   `investigationCount` (dinas ini) + **status pill** (urutan prioritas PERSIS, port apa adanya):
   `investigationCount>0` → `{kind:'investigation', label:'Butuh Investigasi (N)'}`; else `open>0` →
   `{kind:'pending', label:'Waiting for confirmation'}`; else (kalau `total>0`) query tambahan cek
   `subdoc_id IS NULL` di antara baris RESOLVED dinas itu → `0` → `{kind:'reposted', label:'Semua reposted'}`,
   `>0` → `{kind:'waiting-repost', label:'Waiting to repost'}`.

5. **`GET dashboard/summary/:dinasInisiasi/breakdown`** — **TAB-only**. `buildChainAwareProgress(dinasInisiasi,'pair')`
   lalu **filter hasil ke `dinas===dinasInisiasi`** (WAJIB — langkah 7 di atas fetch investigation GLOBAL,
   tanpa filter ini bocor pseudo-card dinas lain). Response `{ dinas_inisiasi, pairs }`.

## Acceptance (HTTP nyata lawan `rdt_dev`)
- [ ] `summary` sebagai PIC (mis. TE) → `is_global_view:false`, `as_initiator` cuma pasangan TE sebagai
  inisiator; sebagai TAB → `is_global_view:true`, `as_initiator` lintas semua inisiator (`groupBy:'pair'`).
- [ ] Pasangan yang **penuh reassign lalu resolve di target baru** → tetap muncul di kartu **target ASLI**
  (bukan hilang), `resolved` naik sesuai.
- [ ] Pasangan yang 100% resolved **dan** sudah ter-subdoc penuh → **hilang** dari `summary` (masuk `history` 4c).
  Pasangan yang sebagian resolved-tapi-belum-ter-subdoc → **tetap tampil**.
- [ ] `need_to_confirm` untuk TAB **termasuk** `Corp` tapi **TIDAK termasuk** `TA` sebagai target implisit.
- [ ] `kpis` PIC vs TAB → shape beda sesuai spek di atas, `resolved_count = total - open_count` (PIC).
- [ ] `per-dinas-rollup` (TAB) → status pill benar utk 4 kasus (investigation/pending/reposted/waiting-repost) — set data uji buat masing-masing.
- [ ] `breakdown/:dinas` (TAB) → HANYA pseudo-card investigation milik dinas itu (uji dengan >1 dinas yang punya baris NEEDS_INVESTIGATION, pastikan tak bocor).
- [ ] Non-TAB akses `per-dinas-rollup`/`breakdown` → 403.
- [ ] `overdue:true` konsisten dengan pola 4a/4c (periode_efektif bergeser dari mayoritas).
- [ ] **178 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Di luar scope (→ 5c)
- `GET/POST detail/:pair` + `GET/POST detail/:pair/comments` (comment thread, ada tulis DB).

## Setelah selesai
Laporkan: struktur module + helper bersama, hasil tiap acceptance (khususnya visibility-cutoff,
chain-ke-target-asli, status pill 4 kasus, breakdown-no-leak), konfirmasi 178 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 5b ✅.
