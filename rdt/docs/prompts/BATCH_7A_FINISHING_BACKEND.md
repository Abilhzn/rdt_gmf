# PROMPT — Batch 7a: Finishing Backend (env fail-fast, withTransaction polish, lint, Swagger)

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 7). **Jangan pecahkan
> 254 test yang sudah hijau.** Ini polish di atas kode yang sudah teruji lawan DB nyata — perubahan
> harus MINIMAL & bertarget, bukan refactor besar. `rdt/backend/` (Express lama) tetap tak disentuh.

## 1. Env fail-fast (ditunda dari Batch 0)

Sumber: `src/config/configuration.ts` — SEMUA env var sekarang fallback diam-diam ke default kalau
hilang/salah (mis. `DB_PASSWORD` → `''`, `IDENTITY_MODE` salah ketik → diam-diam jadi `'dev-mock'`).

**Yang WAJIB gagal keras saat boot** (bukan silent fallback):
- `NODE_ENV==='production' && IDENTITY_MODE!=='ocx'` → **THROW saat boot, app tidak boleh start**.
  Ini bukan cuma soal kerapian config — kalau ini lolos ke produksi, siapa pun bisa impersonate
  user/role manapun lewat header `x-dev-*` (dev-mock tidak validasi apa pun). Prioritas tertinggi.
- `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` — kosongkan default-nya, **wajib ada di
  `.env`** (boleh tetap kosong-string secara eksplisit kalau memang begitu setup-nya, tapi tidak
  boleh diam-diam fallback dari `undefined`).
- `IDENTITY_MODE`/`DIRECTORY_MODE`/`STORAGE_DRIVER` — kalau diisi tapi BUKAN salah satu nilai valid
  (mis. `IDENTITY_MODE=ocxx` typo) → **THROW saat boot** (jangan diam-diam fallback ke default
  seolah tidak diisi — typo yang lolos itu lebih berbahaya daripada kosong).

**Cara implementasi** (pilihan ada di eksekutor, project sudah pakai `class-validator` di DTO —
lebih konsisten pakai pendekatan sama, mis. `Env` class + `validateSync` di `ConfigModule.forRoot({
validate })`, daripada nambah dependency baru seperti Joi — tapi keputusan akhir di eksekutor kalau
ada alasan kuat lain). Pesan error harus jelas nyebut env var mana yang bermasalah, bukan stack
trace generik.

## 2. Polish `withTransaction` (`src/core/database/database.service.ts`)

Masalah saat ini: `catch (err) { await client.query('ROLLBACK'); throw err; }` — kalau statement
ROLLBACK itu sendiri gagal (mis. koneksi sudah mati/dropped), error ASLI (`err`) ketutup oleh error
ROLLBACK yang baru terjadi (karena `throw err` di baris berikutnya tidak pernah ke-reach). Dan
`finally { client.release(); }` mengembalikan koneksi yang berpotensi rusak itu balik ke pool tanpa
tanda apa pun — `pg` punya `client.release(err)` khusus untuk ini, supaya pool MEMBUANG koneksi itu
alih-alih mendaur ulangnya buat query berikutnya (yang bisa gagal misterius lagi).

**Perbaikan:**
```ts
async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  let txnError: unknown;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    txnError = err;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Log rollbackErr (tak menutupi txnError yang tetap di-throw) — koneksi kemungkinan sudah
      // rusak; client.release(txnError) di finally akan membuang koneksi ini dari pool.
    }
    throw txnError;
  } finally {
    client.release(txnError);
  }
}
```
(Pseudocode di atas — sesuaikan gaya logging proyek ini, cek apakah ada logger service yang sudah
dipakai di tempat lain sebelum pakai `console.error` mentah.) **Verifikasi tak ada regresi**: jalankan
test suite `database.service.spec.ts` (kalau ada) atau tulis 1-2 test baru utk cabang
rollback-gagal + happy-path tetap sama.

## 3. Lint + dead-code sweep (seluruh `backend-nest/src`)

- `npm run lint` → **0 warning, 0 error** (bukan cuma 0 error). Kalau ada `eslint-disable` yang
  menumpuk dari batch-batch sebelumnya, tinjau ulang — pertahankan yang genuinely perlu (sudah
  dikomentari alasannya di kode, banyak ditemukan sepanjang project ini), buang yang tidak.
- Cari **dead code**: export yang tak pernah diimpor di mana pun, fungsi/method privat yang tak
  dipanggil, file yang tak ter-wire ke module manapun. Gunakan tooling (`ts-prune` atau setara
  kalau tersedia) ATAU tinjau manual per-module — laporkan apa yang ditemukan SEBELUM menghapus
  kalau ragu itu genuinely dead vs sengaja jadi public API (mis. re-export dari `index.ts`).
- **JANGAN hapus** kode yang "kelihatan tak terpakai" tapi sebenarnya dipakai lewat DI (constructor
  injection Nest tidak selalu kelihatan dari static analysis biasa) — verifikasi via `grep`/search
  penggunaan sebelum hapus apa pun yang berbau providers/modules.

## 4. Swagger final pass (`src/core/swagger/swagger.setup.ts` + semua controller)

Sekarang masih skeleton Batch 0 (versi `0.1.0`, nol `@ApiTags`). Untuk handoff ke IT, Swagger harus
jadi dokumentasi API yang genuinely berguna:
- Tambah `@ApiTags('<nama-modul>')` di tiap controller (satu tag per module: repost-upload,
  repost-mapping, repost-confirmation, repost-reassignment, repost-investigation, repost-persist,
  repost-export, notification, dashboard, period-deadlines, share-cost, master-data).
- Bump versi ke `1.0.0` (rewrite fitur-lengkap, bukan lagi skeleton `0.1.0`).
- Deskripsi disesuaikan menyebut ini backend NestJS hasil rewrite (bukan generic placeholder).
- `@ApiOperation`/`@ApiResponse` per endpoint OPSIONAL kalau waktu terbatas — prioritaskan
  `@ApiTags` (biar endpoint ter-grup rapi) di atas deskripsi detail per-endpoint.

## 5. Verifikasi akhir

- `npm run build` bersih.
- `npm run lint` — 0 warning, 0 error.
- `npm test` — **254 test tetap hijau** (atau lebih kalau ada test baru dari item 2).
- `npm run start` → `GET /health` → `{status:'ok', db:'ok'}` lawan `rdt_dev`.
- Boot dengan `NODE_ENV=production` + `IDENTITY_MODE` sengaja dikosongkan/salah → app **GAGAL START**
  dengan pesan jelas (buktikan fail-fast item 1 beneran jalan).
- `GET /docs` → Swagger UI, cek tag-tag baru muncul & ter-grup benar.
- `rdt/backend/` (Express lama) tak berubah.

## Setelah selesai
Laporkan: perubahan `configuration.ts` (pendekatan validasi yang dipakai), diff `withTransaction`,
hasil lint (before/after count kalau ada), daftar dead-code yang ditemukan+dihapus (atau dikonfirmasi
tak ada), bukti fail-fast production+identity gagal start, screenshot/deskripsi Swagger UI baru.
Update `RENCANA_REWRITE_NESTJS.md` §0 → tandai progres Batch 7 (backend) di §8, JANGAN tandai
Batch 6/7 penuh ✅ — itu nunggu Batch 8 (verifikasi UI).
