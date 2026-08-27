# RDT Review — Panduan Perbaikan Project OPEX Backend

> **Sumber:** transkripsi markdown dari `CATATAN_BE_FE_RDT.pdf` (review tim IT GMF).
> **Review oleh:** Agung Bayu Sapudin · **Tanggal:** 21 Agustus 2026 (dibuat 21 Agu 2026, 15:01).
>
> ⚠️ **Acuan otoritatif untuk implementasi RDT tetap `RENCANA_REWRITE_NESTJS.md`.**
> Dokumen ini adalah *sumber mentah* (arahan generik dari IT untuk sistem OPEX). Keputusan
> spesifik + penyesuaian untuk project RDT sudah dirangkum & diputuskan di tracker itu
> (lihat bagian **"Penyesuaian untuk RDT"** di bawah). Kalau ada beda, **tracker yang menang.**

Dokumen ini berisi catatan review dan panduan perbaikan untuk project code, mencakup bagian
backend dan frontend. Tujuannya supaya code yang dibuat konsisten, rapi, dan mudah dipahami oleh
developer lain yang ikut mengerjakan project ini.

---

## BACKEND

### 1. Teknologi yang digunakan

Backend seharusnya menggunakan **NestJS**. Alasannya karena harus menyesuaikan dengan sistem OCX
yang sudah ada (existing), jadi teknologi yang dipakai harus selaras supaya tidak ada gap antara
sistem baru dengan sistem lama — baik dari sisi arsitektur, pola coding, maupun cara integrasi
antar service.

Beberapa hal yang perlu diperhatikan saat pakai NestJS:

- Gunakan **module based architecture** — setiap fitur dipisah dalam module masing-masing
  (controller, service, dto, dll dalam satu module).
- Manfaatkan **dependency injection bawaan** NestJS, jangan bikin instance manual.
- Pakai **decorator** NestJS secara konsisten (misalnya `@Controller`, `@Injectable`, `@Module`)
  sesuai standar yang sudah ada di sistem OCX.
- Ikuti **versi NestJS dan library pendukung** yang sudah dipakai di sistem existing supaya tidak
  ada konflik dependency.

### 2. Standarisasi struktur file

Struktur folder project harus mengikuti standar yang sudah ditentukan, contohnya seperti berikut
(mengacu pada struktur project `opex-backend`):

```
src/
├── config/                 → konfigurasi aplikasi (env, database, dll)
├── core/                   → resource yang dipakai bersama di seluruh project
│   ├── dtos/               → data transfer object umum
│   ├── enums/              → enum yang dipakai lintas module
│   ├── errors/             → custom error class
│   ├── exception/          → exception filter/handler
│   ├── interfaces/         → interface/type kontrak bersama
│   ├── minio/              → koneksi/util untuk minio (object storage)
│   ├── service/            → service umum/reusable
│   ├── swagger/            → konfigurasi dokumentasi api
│   ├── types/              → type definition tambahan
│   ├── utils/              → helper function
│   └── base.controller.ts  → base controller yang bisa di-extend
└── modules/                → seluruh fitur/domain aplikasi
    ├── approval/
    ├── budget-upload/
    ├── capex/
    │   ├── approval/
    │   ├── approval-reallocation/
    │   ├── approval-request/
    │   │   ├── dtos/
    │   │   ├── approval-request.controller.ts
    │   │   ├── approval-request.module.ts
    │   │   └── approval-request.service.ts
    │   ├── budget-invest-log/
    │   ├── budget-investation/
    │   ├── guidance/
    │   ├── master-data/
    │   ├── realization-invest/
    │   ├── reallocation-invest/
    │   ├── report/
    │   └── user-soe/
    ├── dashboard/
    ├── guidance/
    ├── kurs/
    ├── m-cost-center/
    ├── m-doc-category/
    ├── m-gl-account/
    ├── m-status/
    ├── minio/
    └── notification/
```

Beberapa catatan penting soal struktur ini:

- Setiap module punya folder sendiri di dalam `modules`, isinya controller, service, module, dan
  dtos untuk fitur tersebut.
- Kalau ada domain besar yang punya banyak sub-fitur (contohnya `capex`), maka dipecah lagi jadi
  sub-folder per fitur, seperti `approval`, `approval-reallocation`, `approval-request`, dan seterusnya.
- Semua yang sifatnya reusable atau dipakai lintas module ditaruh di folder `core`, jangan diulang
  di masing-masing module.
- Penamaan file dan folder harus konsisten — pakai **kebab-case** untuk nama folder dan file
  (contoh: `approval-request`, `budget-upload`).
- Setiap module sebaiknya **self-contained** — artinya kalau module tersebut dihapus, tidak merusak
  module lain kecuali yang memang bergantung langsung.

### 3. Clean code

Pastikan code yang dibuat clean code dan mudah dibaca oleh developer lain. Beberapa poin yang bisa
jadi acuan:

- Penamaan variabel, function, dan class harus jelas dan menggambarkan fungsinya; hindari nama
  singkatan yang ambigu.
- Satu function sebaiknya hanya melakukan satu tanggung jawab (**single responsibility**).
- Hindari nested condition yang terlalu dalam — kalau perlu, pecah jadi function terpisah.
- Hapus code yang tidak terpakai (**dead code**), jangan dibiarkan menumpuk.
- Gunakan **DTO dan validasi input** di setiap endpoint supaya data yang masuk sudah tervalidasi
  sejak awal.
- Tambahkan **komentar hanya untuk bagian yang memang butuh penjelasan logika bisnis**, bukan untuk
  menjelaskan hal yang sudah jelas dari kode itu sendiri.
- Konsisten dalam format code — sebaiknya pakai linter dan formatter (misalnya **ESLint dan
  Prettier**) supaya style code seragam di semua developer.
- Sebelum push atau merge, sebaiknya dicek dulu apakah code masih mengikuti standar struktur dan
  clean code di atas.

---

## FRONTEND

Catatan untuk bagian frontend:

- Terapkan clean code di semua bagian frontend — mulai dari penamaan komponen, pemisahan logic dan
  tampilan, sampai struktur folder.
- Referensi yang bisa dipakai sebagai acuan clean code:
  `https://github.com/Gatjuat-Wicteat-Riek/clean-code-book`

Beberapa poin tambahan yang bisa diterapkan di frontend supaya sejalan dengan prinsip clean code:

- Pisahkan komponen berdasarkan fungsinya — misalnya komponen UI murni (**presentational**) dipisah
  dari komponen yang menangani logic/state (**container**).
- Hindari komponen yang terlalu besar — kalau sudah terlalu panjang, sebaiknya dipecah jadi beberapa
  komponen kecil.
- Gunakan penamaan folder dan file yang konsisten dengan struktur backend supaya tim lebih mudah
  menyesuaikan.
- Hindari duplikasi logic — kalau ada logic yang dipakai berulang, buat jadi custom hook atau
  helper function.
- Pastikan setiap komponen dan function punya tanggung jawab yang jelas, sama seperti prinsip di backend.

---

## Kesimpulan

Secara umum, tujuan dari review ini adalah supaya project code — baik backend maupun frontend —
punya standar yang jelas dan konsisten. Backend **wajib menggunakan NestJS** supaya selaras dengan
sistem OCX yang sudah ada, struktur foldernya mengikuti pola `modules` dan `core` seperti dicontohkan
di atas, dan semua code harus clean code supaya mudah dibaca dan dilanjutkan developer lain. Frontend
juga harus mengikuti prinsip clean code yang sama, dengan referensi clean code book yang sudah
dilampirkan.

---

## Penyesuaian untuk RDT
*(Bagian ini BUKAN bagian dokumen asli IT — catatan pemetaan ke project RDT. Detail & alasan penuh di `RENCANA_REWRITE_NESTJS.md`.)*

Arahan di atas bersifat generik untuk sistem OPEX. Berikut cara RDT menerapkannya, termasuk deviasi
sadar yang sudah disepakati:

| Arahan IT | Penerapan di RDT |
|---|---|
| Backend NestJS, module-based, DI, decorator | ✅ Diikuti penuh. |
| Struktur `core/` + `modules/`, kebab-case, self-contained | ✅ Prinsipnya diikuti. **Pohon `opex-backend` asli tidak bisa disalin 100%** (tak ada aksesnya) — ditulis konvensi setara. Pohon RDT aktual → tracker §2. |
| Ikuti versi NestJS/library OCX | ⚠️ Tak ada akses versi OCX → pakai **NestJS 11 stable**; dicatat untuk rekonsiliasi IT saat integrasi (tracker §7). |
| `core/minio` (object storage) | ⚠️ Dev pakai **FilesystemStorageAdapter** di balik `StorageService`; adapter MinIO dicadangkan untuk OCX. Boundary sama, swappable via `STORAGE_DRIVER` (tracker §1.6). |
| DTO + validasi tiap endpoint | ✅ `class-validator` + `class-transformer`, ValidationPipe global. |
| Clean code, ESLint+Prettier, no dead code, komentar bisnis saja | ✅ Jadi guardrail tetap (tracker §6), plus disiplin port (fungsi dipecah stepdown). |
| Frontend: presentational vs container, komponen kecil, no duplikasi logic | ✅ Angular: **smart/dumb component**; service/util = padanan "custom hook"; Login/SelectPlatform dibuang (identity dari OCX). |
| *(tidak disebut IT — keputusan RDT)* | **Tanpa module `auth`** (identity disediakan OCX, dibaca via `core/security`); **raw `pg` + repository**, bukan ORM (jaga `FOR UPDATE`/transaksi); **tanpa Docker** (Postgres native). Alasan → tracker §1/§5/§7. |

---

_Transkripsi dibuat 25 Agustus 2026 dari `CATATAN_BE_FE_RDT.pdf`, untuk konsumsi executor/Graphify._
