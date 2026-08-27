# Panduan Kodingan RDT — Cara Baca Kode, Bukan Isi Bisnisnya

Buat kamu yang jago data engineering tapi masih baru di web dev. Setiap pola di sini
dijelasin pakai analogi ke hal yang kemungkinan udah kamu kenal, lalu ditunjukkin
persis di mana pola itu muncul di kode kita.

---

## BAGIAN 1 — JavaScript Dasar yang Dipakai DI MANA-MANA

Sebelum masuk NestJS/Angular, ini 6 idiom JS yang bakal kamu lihat di HAMPIR SETIAP
file. Kalau ini udah klik, baca kode apapun di project ini jadi jauh lebih gampang.

### 1a. `async`/`await` — nunggu sesuatu yang lambat (network, database)

```js
async function requireUser(req, res, next) {
  const verifyRes = await fetch(`${AUTH_SERVICE_URL}/verify`, { headers });
  const body = await verifyRes.json();
}
```

Analogi: kayak `cursor.execute(query); rows = cursor.fetchall()` di Python — baris
kedua BARU jalan setelah baris pertama beneran selesai, bukan langsung lanjut sambil
query-nya masih jalan di background. `await` itu "tunggu ini kelar dulu, baru
lanjut". `async` di depan `function` itu wajib ditulis kalau di DALAM fungsi itu ada
`await` — semacam penanda "fungsi ini isinya ada nunggu-nunggunya".

### 1b. Destructuring — "buka bungkusan" langsung pas nerima

```js
function deriveStateLabel({ pendingCount, targetDinas, subdocNumbers }) {
```

Ini nerima SATU object (mis. `{pendingCount: 5, targetDinas: 'TC', subdocNumbers: []}`)
tapi langsung "dibongkar" jadi 3 variabel terpisah di judul fungsinya. Analogi Python:
mirip `def f(**kwargs)` tapi kamu langsung nyebutin nama field yang mau diambil,
bukan `kwargs['pendingCount']` di dalem fungsi.

### 1c. Template literal — gabung string pakai backtick + `${...}`

```js
`Waiting for confirmation ${targetDinas}`
```

Sama persis kayak f-string Python: `f"Waiting for confirmation {targetDinas}"`.
Backtick (`` ` ``), bukan kutip biasa.

### 1d. Arrow function `=>` — fungsi pendek tanpa tulis `function`

```js
const r = await client.query(..., [id]);
return r.rows.map((r) => r.code);
```

`(r) => r.code` itu setara `lambda r: r.code` di Python. Kalau badannya lebih dari
satu baris, dibungkus kurung kurawal: `(r) => { const x = r.code; return x; }`.

### 1e. Ternary `? :` — if/else dalam satu baris

```js
res.status(verifyRes.status === 401 ? 401 : 502).json(body);
```

Sama kayak `401 if verify_res.status == 401 else 502` di Python — urutannya cuma
dibalik: `kondisi ? kalauTrue : kalauFalse`.

### 1f. Optional chaining `?.` dan nullish coalescing `??`/`||`

```js
description?.trim() || ''
```

`?.` = "akses properti ini KALAU objectnya ada, kalau `null`/`undefined` ya udah
berhenti jadi `undefined`, jangan error". Analogi: kayak `getattr(obj, 'trim', None)`
tapi lebih ringkas. `|| ''` di belakang = "kalau hasilnya kosong/falsy, pakai string
kosong sebagai default".

---

## BAGIAN 2 — NestJS (Backend): Decorator + Guard, Bukan Middleware Chain

File: `rdt/backend/src/modules/repost/confirmation/confirmation.controller.ts` +
`rdt/backend/src/core/security/dinas-access.guard.ts`

**Konsep inti (masih mirip pipeline ETL, tapi cara nyusunnya beda)**: di Express (backend
lama, `rdt/backend`, sudah dihapus dari repo ini), tiap "stage" ditulis manual sebagai
fungsi yang disusun berurutan di route (`router.get('/:dinas', requireDinasAccess('dinas'),
handler)`). NestJS (`rdt/backend`, backend yang aktif sekarang) masih ngejalanin
stage-stage yang sama secara konsep (cek identitas → cek otorisasi → handler), tapi
disusun pakai **decorator** (anotasi `@Sesuatu(...)` nempel di class/method) + **Guard**
(class terpisah yang jawab ya/tidak "boleh lanjut?"), bukan array fungsi di satu baris.

```ts
@Controller('repost/confirmation')
@UseGuards(DinasAccessGuard)             // <- "stage" otorisasi, jalan SEBELUM handler manapun di controller ini
export class ConfirmationController extends BaseController {
  constructor(private readonly confirmation: ConfirmationService) { super(); }

  @Get(':dinas')
  async getQueue(@Param('dinas') dinas: string) {
    return this.ok(await this.confirmation.getQueue(dinas));
  }
}
```

- `@Controller('repost/confirmation')` = "class ini nanganin semua route yang path-nya
  diawali `/repost/confirmation`" — pengganti `router = express.Router()` + `app.use(...)`.
- `@UseGuards(DinasAccessGuard)` di ATAS class = berlaku buat SEMUA handler di controller
  ini (setara masang middleware sebelum tiap route di file `confirmation.js` lama). Bisa
  juga dipasang per-handler (di atas satu `@Get()`/`@Post()` doang) kalau cuma satu endpoint
  yang butuh guard itu — lihat `reassignment.controller.ts`.
- `@Get(':dinas')` / `@Param('dinas')` = pengganti `router.get('/:dinas', ...)` +
  `req.params.dinas` — Nest yang urus parsing-nya, kamu tinggal declare parameter apa yang
  kamu mau ambil dari request.

**`DinasAccessGuard` itu setara `requireDinasAccess` di Express lama** — tempat logika
otorisasi beneran ditulis, cuma bentuknya class dengan satu method wajib
(`canActivate`), bukan fungsi yang manggil `next()`:

```ts
@Injectable()
export class DinasAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithIdentity>();
    if (!req.identity) {
      throw new DomainError('Authentication required', 401, 'UNAUTHENTICATED');
    }
    if (req.identity.role === 'TAB') return true;          // TAB boleh akses dinas mana pun
    const targetDinas = String(req.params.dinas ?? '').toUpperCase();
    if (String(req.identity.dinas).toUpperCase() === targetDinas) return true;
    throw new DomainError(`... not authorized for dinas=${targetDinas}`, 403, 'FORBIDDEN_DINAS');
  }
}
```

Beda paling penting dari `next()` di Express: **gak ada fungsi "lanjut ke stage
berikutnya" yang dipanggil manual**. Guard cuma `return true` (boleh lanjut ke handler)
atau `return false`/`throw` (berhenti, otomatis jadi response error — di sini lewat
`DomainError` yang ditangkap `GlobalExceptionFilter`,
`rdt/backend/src/core/exception/global-exception.filter.ts` — dipasang global,
ngubah semua error jadi response JSON konsisten `{statusCode, message, error}`). Nest yang urus
"lanjut atau berhenti"-nya di belakang layar, kamu tinggal balikin boolean/throw.

**Dari mana `req.identity` itu datang?** Beda lagi dari Express lama yang re-verify token
ke `auth` service tiap request (`requireUser` manggil `fetch(AUTH_SERVICE_URL)`) —
`rdt/backend` punya `IdentityMiddleware` (middleware Express biasa, masih ada karena
Nest jalan DI ATAS Express) yang nempelin `req.identity` SEKALI per request, sebelum guard
manapun jalan (didaftarkan di `app.module.ts`: `consumer.apply(IdentityMiddleware).forRoutes('*')`).
Isinya tergantung `IDENTITY_MODE` di `.env` — `dev-mock` (baca header `x-dev-*` buat lokal)
atau `ocx` (baca header `x-ocx-*` yang di-suntik OCX di produksi, lihat `rdt/docs/IRS.md`).

**Role check** (analogi `requireRole('TAB')` di kode lama) pakai kombo decorator +
guard yang mirip, tapi dua file terpisah — `@Roles('TAB')` (nempel metadata doang, gak
ngecek apa-apa sendiri) dibaca sama `RolesGuard` (yang beneran ngecek):

```ts
@Controller('repost/export')
@UseGuards(RolesGuard)
export class ExportController {
  @Post()
  @Roles('TAB')                 // cuma metadata — RolesGuard yang baca & tegakkan ini
  async createBatch(...) { ... }
}
```

---

## BAGIAN 3 — PostgreSQL dari Node.js: Parameterized Query & Transaction

File: `rdt/backend/src/modules/repost/confirmation/confirmation.service.ts` +
`rdt/backend/src/core/database/database.service.ts`

### Parameterized query — udah familiar dari data engineering

```ts
const r = await client.query(
  `SELECT t.id, t.account, t.nominal FROM rdt.transactions t WHERE t.dinas_target=$1 AND t.status_konfirmasi=$2`,
  [dinas, 'PENDING']
);
```

Persis konsep yang sama kayak `cursor.execute(query, (dinas, 'PENDING'))` di
`psycopg2` — `$1`/`$2` itu placeholder, nilainya disuntikkan AMAN lewat array kedua,
BUKAN digabung manual ke string SQL (itu yang bikin rawan SQL injection). Aturan di
project ini: **gak ada satupun query yang nggabung string manual buat data dari
user** — selalu `$1,$2,...` + array. `rdt/backend` gak pakai ORM (lihat
`RENCANA_REWRITE_NESTJS.md` §5) — raw SQL lewat `pg`, dibungkus satu `DatabaseService`
yang semua module inject lewat DI, bukan `new Pool()` sendiri-sendiri.

### Transaction — `withTransaction`, tetap BEGIN/COMMIT/ROLLBACK di baliknya

```ts
await this.db.withTransaction(async (client) => {
  // ...banyak query UPDATE/INSERT di sini, pakai `client`, bukan `this.db.query`...
});
```

`withTransaction` (`database.service.ts`) itu pembungkus: `BEGIN` → jalanin fungsi yang
kamu kasih → `COMMIT` kalau sukses, `ROLLBACK` otomatis + re-throw kalau fungsinya
`throw`. Konsepnya PERSIS sama kayak `BEGIN`/`try`/`COMMIT`/`catch`/`ROLLBACK` manual di
Express lama — cuma sekarang pola itu ditulis SEKALI di satu tempat (`DatabaseService`),
bukan diulang-ulang di tiap route handler. Ini penting banget di kode finansial kita
(konfirmasi + ledger entry harus tercatat BARENG, gak boleh cuma salah satu).

### `FOR UPDATE` — row locking

```ts
const { rows } = await client.query<LockedTransactionRow>(
  `SELECT t.id, ... FROM rdt.transactions t JOIN rdt.uploads u ON u.id = t.upload_id
   WHERE t.id = $1 FOR UPDATE OF t`,
  [id],
);
```

`FOR UPDATE` = "kunci baris ini, jangan biarin proses LAIN baca/ubah baris yang sama
sampai transaction ini selesai". Ini yang nyegah 2 orang confirm baris yang sama
bersamaan (*race condition*) — analoginya kayak `SELECT ... FOR UPDATE` di SQL
standar mana pun, konsepnya sama, cuma di sini eksplisit ditulis karena `pg` gak
auto-lock kayak beberapa ORM.

---

## BAGIAN 4 — TypeScript & Angular (Frontend)

File: `rdt/frontend/rdt/shared/pagination.component.ts`

### Interface / type — kayak type hint Python, tapi DIPAKSA sama compiler

```ts
export interface PendingRow {
  id: number;
  nominal: number;
  remark?: string;   // tanda tanya = field ini OPSIONAL, boleh gak ada
}
```

Mirip `@dataclass` Python dengan type hints, bedanya: TypeScript **nolak nge-compile**
kalau kamu coba masukin data yang gak cocok bentuknya ke variabel bertipe `PendingRow`
— di Python, type hint itu cuma dokumentasi (gak dicek beneran kecuali pakai `mypy`).

### Decorator `@Component` — nempelin "metadata" ke class

```ts
@Component({
  selector: 'rdt-pagination',        // nama tag HTML custom: <rdt-pagination>
  templateUrl: './pagination.component.html',   // file HTML-nya
})
export class PaginationComponent { ... }
```

Sama konsepnya kayak decorator Python (`@dataclass`, `@app.route(...)` di Flask) —
`@Component({...})` itu nempelin konfigurasi ke class di bawahnya, bilang ke Angular
"class ini adalah komponen UI, begini cara makenya".

### `@Input()` / `@Output()` — gimana komponen "nerima data" dan "ngasih tau balik"

```ts
@Input() page = 1;                              // ORANG TUA (parent) ngasih nilai ke sini
@Output() pageChange = new EventEmitter<number>();  // komponen ini NGASIH TAU balik ke parent
```

Analogi: `@Input` itu kayak PARAMETER fungsi (data masuk dari luar). `@Output` itu
kayak CALLBACK — komponen ini manggil `this.pageChange.emit(3)` buat bilang "user
klik halaman 3", dan siapapun yang "pasang" komponen ini di HTML bisa dengerin
kejadian itu:
```html
<rdt-pagination [page]="currentPage" (pageChange)="onPageChange($event)"></rdt-pagination>
<!--              ^ isi Input                        ^ dengerin Output -->
```

### Getter — kayak `@property` Python

```ts
get totalPages(): number {
  return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
}
```

Dipanggil TANPA kurung: `this.totalPages`, bukan `this.totalPages()`. Dia keliatan
kayak variabel biasa tapi sebenernya ngitung ulang tiap kali diakses — identik sama
`@property` di Python.

---

## BAGIAN 5 — RxJS Observable: Paradigma yang Paling Beda dari Python

File: `rdt/frontend/rdt/services/confirmation.service.ts`

Ini yang paling asing buat orang data engineering, jadi pelan-pelan.

```ts
getPending(dinas: string): Observable<PendingRow[]> {
  return this.http
    .get<{ ok: boolean; rows: PendingRow[] }>(`${this.base}/${dinas}`, { headers: ... })
    .pipe(map((res) => {
      if (!res.ok) throw new Error(res.error);
      return res.rows;
    }));
}
```

**`Observable` itu BUKAN Promise/async biasa** — dia kayak *lazy stream*: gak ada apa-apa
yang beneran jalan sampai ada yang "subscribe" (dengerin). Analogi paling deket dari
data engineering: mirip **Python generator** (`yield`) atau *lazy evaluation* di Spark
— kamu nyusun "resep"-nya dulu (`.pipe(map(...))`), tapi resep itu baru DIEKSEKUSI
pas ada yang manggil `.subscribe()`.

`.pipe(map(fn))` itu kayak **method chaining ala pandas** (`df.pipe(func)`) — tiap
`.pipe()` nge-transform data yang lewat, hasilnya diteruskan ke tahap berikutnya.

Cara makenya di komponen (gak keliatan di file ini, tapi ini polanya di tempat lain):
```ts
this.confirmationService.getPending('TC').subscribe((rows) => {
  this.rows = rows;   // baru di sini datanya beneran "nyampe"
});
```
Kalau kamu lupa `.subscribe()`, **request-nya gak akan pernah kekirim** — ini bug
paling umum buat orang baru pindah dari async/await biasa ke RxJS.

---

## Ringkasan Peta Analogi

| Konsep di kode kita | Analogi dari data engineering/Python |
|---|---|
| `async`/`await` | `cursor.execute()` lalu `fetchall()` — nunggu I/O selesai |
| Guard/Decorator NestJS (`@UseGuards`, `canActivate`) | Stage berurutan di pipeline ETL (tiap stage boleh/gak boleh lanjut) |
| `$1,$2` + array | Parameterized query `psycopg2` |
| `BEGIN`/`COMMIT`/`ROLLBACK` | Transaction SQL standar, sama persis |
| `interface`/`type` TS | `@dataclass` + type hint, tapi DIPAKSA compiler |
| Decorator `@Component`/`@Injectable` | Decorator Python (`@dataclass`, `@app.route`) |
| `@Input`/`@Output` | Parameter fungsi / callback |
| Getter `get x()` | `@property` |
| RxJS `Observable` + `.pipe()` | Python generator (`yield`) / lazy pipeline Spark |

Cara belajar lanjut yang paling efektif: pas nemu file baru, coba tebak dulu "ini
file `rdt/backend` (Nest, `.ts`, ada `@Controller`/`@Injectable`) atau
`rdt/frontend` (Angular, `.ts`, ada `@Component`)?" — keduanya sekarang sama-sama
TypeScript, jadi liat foldernya (`backend/` vs `frontend/`) dan decorator yang
nempel, bukan extension file. Terus cari pola dari tabel di
atas satu-satu. Hampir semua file di project ini isinya kombinasi dari pola-pola yang
udah dijelasin di sini.
