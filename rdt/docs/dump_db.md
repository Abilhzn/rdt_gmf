# Panduan Backup Database RDT (Supabase, Tier Gratis)

Ditulis biar gampang dijadiin script/automasi. Semua command di bawah pakai
environment variable buat connection string — **JANGAN hardcode connection
string ke script yang di-commit ke git**.

---

## 0. Kenapa manual (bukan otomatis dari Supabase)

Tier gratis Supabase **TIDAK PUNYA** backup otomatis atau Point-in-Time Recovery
sama sekali (fitur itu cuma ada mulai paket Pro, $25/bulan). Jadi backup manual
ini satu-satunya jaring pengaman kita sekarang. Begitu project ini beneran jalan
produksi dengan data finansial asli, WAJIB upgrade ke Pro — panduan ini tetap
relevan buat fase development.

---

## 1. Setup sekali di awal

### 1.1 Install Supabase CLI
```powershell
npm install -g supabase
```

### 1.2 Login
```powershell
supabase login
```

### 1.3 Simpan connection string sebagai environment variable (JANGAN hardcode)
```powershell
# PowerShell — set untuk sesi ini saja
$env:RDT_DB_URL = "postgresql://postgres:PASSWORD@HOST:5432/postgres"

# Atau permanen (User-level, gak perlu di-set ulang tiap buka terminal baru)
[System.Environment]::SetEnvironmentVariable("RDT_DB_URL", "postgresql://postgres:PASSWORD@HOST:5432/postgres", "User")
```
Ganti isinya sama connection string Supabase yang ada di `rdt/backend/.env`
(`DATABASE_URL`).

### 1.4 Siapkan folder backup (di LUAR folder yang di-track git)
```powershell
mkdir "E:\_tadashi\project\budgeting_gmf_backups"
```
Sengaja di luar `budgeting_gmf/` (folder repo) biar gak ke-track git sama sekali
— gak perlu ngatur `.gitignore` tambahan, gak ada resiko connection string atau
data ke-commit gak sengaja.

---

## 2. Backup manual (jalanin kapan aja, terutama sebelum perubahan besar)

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
supabase db dump --db-url $env:RDT_DB_URL -f "E:\_tadashi\project\budgeting_gmf_backups\backup_$timestamp.sql"
```

**Alternatif** (kalau `pg_dump` sudah ada dari instalasi PostgreSQL sebelumnya,
gak perlu install Supabase CLI):
```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
pg_dump $env:RDT_DB_URL -f "E:\_tadashi\project\budgeting_gmf_backups\backup_$timestamp.sql"
```

---

## 3. Tes restore (WAJIB dicoba minimal sekali — backup yang gak pernah dites = gak ada backup)

1. Bikin project Supabase BARU khusus buat tes (masih dalam limit 2 project gratis)
2. Set connection string project baru itu ke variable terpisah:
   ```powershell
   $env:RDT_TEST_DB_URL = "postgresql://postgres:PASSWORD@HOST_BARU:5432/postgres"
   ```
3. Restore file backup ke situ:
   ```powershell
   psql $env:RDT_TEST_DB_URL -f "E:\_tadashi\project\budgeting_gmf_backups\backup_2026-08-08_1430.sql"
   ```
4. Verifikasi datanya masuk akal:
   ```powershell
   psql $env:RDT_TEST_DB_URL -c "SELECT COUNT(*) FROM rdt.transactions;"
   ```
5. Project tes boleh dihapus/dibiarin nganggur setelah selesai verifikasi.

---

## 4. Script siap-pakai (`backup_rdt.bat`)

Simpan sebagai `E:\_tadashi\project\budgeting_gmf_backups\backup_rdt.bat` — bisa
dipanggil manual atau dari Task Scheduler (lihat section 5).

```bat
@echo off
setlocal

if "%RDT_DB_URL%"=="" (
    echo ERROR: environment variable RDT_DB_URL belum di-set.
    echo Set dulu: setx RDT_DB_URL "postgresql://..."
    exit /b 1
)

set BACKUP_DIR=E:\_tadashi\project\budgeting_gmf_backups
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set DATESTAMP=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIMESTAMP=%%a%%b

supabase db dump --db-url "%RDT_DB_URL%" -f "%BACKUP_DIR%\backup_%DATESTAMP%_%TIMESTAMP%.sql"

if %ERRORLEVEL% NEQ 0 (
    echo BACKUP GAGAL — cek koneksi/connection string.
    exit /b 1
)

echo Backup berhasil: %BACKUP_DIR%\backup_%DATESTAMP%_%TIMESTAMP%.sql

REM --- Retention: hapus backup lebih dari 14 hari (opsional, sesuaikan angka) ---
forfiles /p "%BACKUP_DIR%" /m backup_*.sql /d -14 /c "cmd /c del @path" 2>nul

endlocal
```

**Catatan penting**: `setx` (buat set environment variable permanen) itu WAJIB
lewat Command Prompt biasa sekali di awal (`setx RDT_DB_URL "connection-string-nya"`),
bukan di dalam `.bat` ini sendiri — env var yang di-set `setx` baru kebaca di
sesi/proses BARU setelah itu, gak langsung kepake di script yang sama.

---

## 5. Automasi via Windows Task Scheduler

1. Buka **Task Scheduler** (search di Start Menu)
2. **Create Basic Task** → kasih nama "RDT DB Backup"
3. Trigger: pilih frekuensi (saran: **Weekly**, cukup buat fase development —
   naikin ke Daily kalau udah mendekati data lebih penting)
4. Action: **Start a program** → browse ke `backup_rdt.bat` yang dibuat di
   section 4
5. Selesai — cek sekali manual dengan klik kanan task itu → **Run**, pastikan
   file backup baru muncul di folder

---

## 6. Checklist keamanan sebelum automasi jalan beneran

- [ ] Connection string TIDAK ada di dalam `.bat` script itu sendiri (pakai env var)
- [ ] Folder backup (`budgeting_gmf_backups`) ada DI LUAR folder yang di-track git
- [ ] Sudah dites restore minimal sekali (section 3)
- [ ] Retention diatur (jangan biarin backup numpuk tanpa batas — script section 4
      sudah include auto-hapus backup >14 hari, sesuaikan sesuai kebutuhan)
