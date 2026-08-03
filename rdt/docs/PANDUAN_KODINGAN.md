# Panduan Kodingan RDT — Cara Baca Kode, Bukan Isi Bisnisnya

Buat kamu yang jago data engineering tapi masih baru di web dev. Setiap pola di sini
dijelasin pakai analogi ke hal yang kemungkinan udah kamu kenal, lalu ditunjukkin
persis di mana pola itu muncul di kode kita.

---

## BAGIAN 1 — JavaScript Dasar yang Dipakai DI MANA-MANA

Sebelum masuk Express/Angular, ini 6 idiom JS yang bakal kamu lihat di HAMPIR SETIAP
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

## BAGIAN 2 — Express.js (Backend): Middleware Chain

File: `rdt/backend/src/middleware/auth.js`

**Konsep inti**: Express itu kayak **pipeline ETL** — satu request lewatin serangkaian
"stage" berurutan, tiap stage bisa (a) lanjutin ke stage berikutnya, atau (b) berhenti
di situ dan langsung balikin response (kayak validasi row yang gagal terus di-drop
dari pipeline, gak lanjut ke stage berikutnya).

```js
async function requireUser(req, res, next) {
  if (!headers['X-Session-Token'] && !headers['X-User-Id']) {
    return res.status(401).json({ ok: false, error: '...' });   // (b) BERHENTI di sini
  }
  req.rdtUser = body.user;
  next();                                                          // (a) LANJUT ke stage berikutnya
}
```

- `req` = data request masuk (headers, body, params URL)
- `res` = alat buat ngirim balik jawaban ke browser
- `next` = fungsi "lanjut ke stage berikutnya" — kalau `next()` GAK dipanggil, request-nya
  "macet" di situ (browser nunggu selamanya) kecuali kamu udah kirim `res.json(...)` duluan

Cara masang middleware ke satu route (dari `confirmation.js`):

```js
router.get('/:dinas', requireDinasAccess('dinas'), async (req, res) => { ... });
//          ^ path        ^ stage 1 (middleware)      ^ stage 2 (handler akhir)
```

Urutan argumen setelah path itu urutan eksekusi. `requireDinasAccess('dinas')` jalan
DULU (cek otorisasi), baru kalau dia manggil `next()`, `async (req,res)=>{...}` jalan.

**`requireDinasAccess` itu "middleware factory"** — fungsi yang RETURN fungsi middleware
lain:

```js
function requireDinasAccess(dinasParam) {
  return function (req, res, next) { ... };   // ini yang beneran jadi middleware-nya
}
```

Kenapa gitu? Biar bisa dipakai ulang dengan parameter beda-beda
(`requireDinasAccess('dinas')` di satu route, mungkin `requireDinasAccess('targetDinas')`
di route lain) — kayak *factory function* atau *decorator dengan argumen* di Python
(`@retry(times=3)` vs `@retry(times=5)`).

---

## BAGIAN 3 — PostgreSQL dari Node.js: Parameterized Query & Transaction

File: `rdt/backend/src/routes/confirmation.js`

### Parameterized query — udah familiar dari data engineering

```js
const r = await client.query(
  `SELECT t.id, t.account, t.nominal FROM rdt.transactions t WHERE t.dinas_target=$1 AND t.status_konfirmasi=$2`,
  [dinas, 'PENDING']
);
```

Persis konsep yang sama kayak `cursor.execute(query, (dinas, 'PENDING'))` di
`psycopg2` — `$1`/`$2` itu placeholder, nilainya disuntikkan AMAN lewat array kedua,
BUKAN digabung manual ke string SQL (itu yang bikin rawan SQL injection). Aturan di
project ini: **gak ada satupun query yang nggabung string manual buat data dari
user** — selalu `$1,$2,...` + array.

### Transaction — BEGIN...COMMIT, sama kayak yang kamu tau

```js
await client.query('BEGIN');
try {
  // ...banyak query UPDATE/INSERT di sini...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
}
```

Sama persis konsep ACID transaction yang udah kamu kenal — kalau ADA SATU query di
tengah yang gagal (`throw`), SEMUA perubahan sebelumnya di transaction itu dibatalin
(`ROLLBACK`), bukan nyangkut setengah-setengah. Ini penting banget di kode finansial
kita (konfirmasi + ledger entry harus tercatat BARENG, gak boleh cuma salah satu).

### `FOR UPDATE` — row locking

```js
const q = await client.query(
  'SELECT ... FROM rdt.transactions WHERE id=$1 FOR UPDATE', [id]
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
| Middleware Express | Stage berurutan di pipeline ETL |
| `$1,$2` + array | Parameterized query `psycopg2` |
| `BEGIN`/`COMMIT`/`ROLLBACK` | Transaction SQL standar, sama persis |
| `interface`/`type` TS | `@dataclass` + type hint, tapi DIPAKSA compiler |
| Decorator `@Component`/`@Injectable` | Decorator Python (`@dataclass`, `@app.route`) |
| `@Input`/`@Output` | Parameter fungsi / callback |
| Getter `get x()` | `@property` |
| RxJS `Observable` + `.pipe()` | Python generator (`yield`) / lazy pipeline Spark |

Cara belajar lanjut yang paling efektif: pas nemu file baru, coba tebak dulu "ini
file Express (backend) atau Angular (frontend)?" dari extension-nya (`.js` di
`backend/` = Express, `.ts` di `frontend/` = Angular), terus cari pola dari tabel di
atas satu-satu. Hampir semua file di project ini isinya kombinasi dari pola-pola yang
udah dijelasin di sini.
