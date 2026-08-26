# PROMPT — Batch 1: repost/upload (Parser Format CBO)

> Tempel ke agent eksekutor. Rujukan: `rdt/docs/RENCANA_REWRITE_NESTJS.md`.
> **DB-independent** — parser cuma baca Excel. Aman jalan paralel dgn smoke-test migration.
> Backend lama `rdt/backend/` **JANGAN disentuh** — hanya sumber kode & test yang di-port.

## Konteks penting (parser sudah di-rewrite 20 Agu)

Parser lama itu **Format CBO** (bukan pivot-cache / 53-kolom lagi — itu semua sudah dibuang).
Sumber: `rdt/backend/src/parser/excelParser.js`. Entry: `parseExcelFile(file, { uploaderDinas })`.
`dinas_target` dibaca **langsung dari kolom Recipient**, di-resolve lewat `mapping.seed.json` +
roster `dinas.codes.json`. Kolom Format CBO: Requester, Account, Detail Group, Profit Ctr, Ref.Doc.,
Period, Text, Material, In PCLC, Curr., Remarks, Recipient (nominal = kolom **In PCLC**).

Status yang bisa dihasilkan (mirror PERSIS dari kode lama, jangan nambah/ngurangin):
- `PENDING` — Recipient ter-resolve ke dinas lain (tagihan lintas dinas).
- `EXCLUDED` — self-repost: Requester == Recipient (case-insensitive).
- `NEEDS_REVIEW` — Recipient tak dikenal (bukan alias mapping, bukan roster) → sertakan `reason_if_invalid`.
- `NEEDS_INVESTIGATION` — Recipient == "Ask TA" (bukan dinas; ambigu, perlu TAB investigasi). `dinas_target` null.

## Tugas

### 1. Port parser → `modules/repost/upload/parser/excel-parser.service.ts`
- **SATU** service (tidak ada pivot-cache-reader). Port logika `parseExcelFile` + helper
  (`parseNumber`, `readCellValue`, `buildAllowedCodes`, `buildDetailRow`, deteksi sheet Format CBO).
- **Port = refactor rapi, bukan copy-paste**: pecah jadi method kecil satu tanggung jawab (stepdown),
  TypeScript strict, tanpa flag-argument. **Logika & output identik** — angka & status tidak boleh berubah.
- Bungkus ExcelJS di dalam service (Boundaries) — konsumen tak lihat ExcelJS langsung.

### 2. Seed resolusi dinas (biar test hijau tanpa DB)
- Copy `rdt/backend/src/config/mapping.seed.json` + `dinas.codes.json` ke `backend-nest`
  (mis. `src/config/` atau `modules/repost/upload/`). Parser baca dari sini di Batch 1.
- (Batch 2 nanti pindahin sumber mapping ke DB; sekarang cukup file.)

### 3. Enum
- `core/enums/RowStatus` isi lengkap: `PENDING`, `EXCLUDED`, `NEEDS_REVIEW`, `NEEDS_INVESTIGATION`
  (+ status lain HANYA kalau kode lama emang emit — cek dulu, jangan mengarang).

### 4. Endpoint parse (preview) — `upload.controller.ts` + DTO
- `POST` upload file → simpan via `StorageService` (driver filesystem dari Batch 0.5) → `parseExcelFile(path)`
  → balikin preview rows + rekap per dinas_target. **Pakai DTO + ValidationPipe.**
- **`persist` (tulis ke DB) DITUNDA** — butuh transaksi/DB, masuk batch setelah confirmation. Batch 1 stop di preview.

### 5. Port test parser → Jest (`.spec.ts`)
- Port `rdt/backend/test/parser.test.js` ke Jest project baru: sesuaikan import ke service +
  path fixture ke `rdt/contoh_input/` yang sudah ada (`06. DT TB - Jun 2026.xlsx`, `06. DT TJ - Jun 2026.xlsx`).
- Test lain (`authorization`, `reassignmentRules`, `periodEffective`, `mentionRules`, dst) **BUKAN** Batch 1 —
  ikut batch masing-masing. Batch 1 cuma test yang murni nguji `parseExcelFile`.

## Acceptance (angka WAJIB sama persis)
- [ ] TB file → **469 baris**, semua PENDING, total per target: TC 94732.21, TF 360.21, TJ 46353.37, TL 112867.35, TN 860.64, Corp 3294.95.
- [ ] TJ file → **490 baris**; PENDING per target: TE 84.36, TMM 473933.51, TA 1653.24; **3 baris NEEDS_INVESTIGATION** total **40393.29** (dinas_target null); **tidak ada** NEEDS_REVIEW.
- [ ] Recipient tak dikenal → NEEDS_REVIEW + reason memuat nilai mentahnya; self-repost (Requester==Recipient, case-insensitive) → EXCLUDED.
- [ ] `npm test` hijau, `npm run lint` bersih, `npm run build` bersih.
- [ ] `rdt/backend/` lama tidak berubah.

## Di luar scope
- `persist` ke DB, mapping via DB (Batch 2), confirmation/export/dll.
- Frontend.

## Setelah selesai
Laporkan: struktur `repost/upload`, hasil `npm test` (khususnya angka TB/TJ di atas), method hasil pemecahan parser.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 1 ✅ (setelah smoke-test DB juga hijau).
