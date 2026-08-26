# verify-persist-3.5b.ps1
# Script sekali-pakai buat verifikasi Batch 3.5b (persist) lawan DB nyata.
# Jalanin dari folder backend-nest, di TERMINAL BARU (app harus sudah `npm run start` di terminal lain,
# dan .env sudah diarahkan ke rdt_persist_test seperti langkah 1-3 tutor).
# Pakai curl.exe untuk multipart (kompatibel Windows PowerShell 5.1 & pwsh 6+, tidak seperti -Form).
#
# Cara pakai:
#   cd E:\_tadashi\project\budgeting_gmf\rdt\backend-nest
#   .\verify-persist-3.5b.ps1
#
# Paste SELURUH output yang muncul di terminal balik ke chat.

$ErrorActionPreference = "Continue"
$base = "http://localhost:3000"
$fileTJ = "E:\_tadashi\project\budgeting_gmf\rdt\contoh_input\06. DT TJ - Jun 2026.xlsx"

Write-Host "`n=== STEP A: Health check ===" -ForegroundColor Cyan
$healthRaw = curl.exe -s "$base/health"
Write-Host $healthRaw

Write-Host "`n=== STEP B: Parse file TJ (harus 490 rows) ===" -ForegroundColor Cyan
$parseRaw = curl.exe -s -X POST "$base/repost/upload/parse" `
    -H "x-dev-user-id: u_tj_pic" -H "x-dev-dinas: TJ" -H "x-dev-role: PIC" `
    -F "file=@$fileTJ" `
    -F "uploaderDinas=TJ"

try {
    $parseResp = $parseRaw | ConvertFrom-Json
} catch {
    Write-Host "GAGAL parse -- response bukan JSON valid:" -ForegroundColor Red
    Write-Host $parseRaw
    exit 1
}

if ($parseResp.data -and $parseResp.data.rows) {
    $rowCount = $parseResp.data.rows.Count
} elseif ($parseResp.rows) {
    $rowCount = $parseResp.rows.Count
    # fallback kalau struktur respons ternyata { rows: [...] } langsung, bukan { data: { rows: [...] } }
} else {
    Write-Host "GAGAL parse -- struktur response tidak dikenali:" -ForegroundColor Red
    Write-Host $parseRaw
    exit 1
}
Write-Host "Jumlah rows hasil parse: $rowCount (harus 490)"
if ($rowCount -ne 490) { Write-Host "PERINGATAN: row count tidak sesuai ekspektasi." -ForegroundColor Yellow }

Write-Host "`n=== STEP C: Persist hasil parse ===" -ForegroundColor Cyan
$rows = if ($parseResp.data -and $parseResp.data.rows) { $parseResp.data.rows } else { $parseResp.rows }
$rowsJson = $rows | ConvertTo-Json -Depth 10 -Compress
$rowsFile = Join-Path $PSScriptRoot "rows-temp.json"
$rowsJson | Out-File -FilePath $rowsFile -Encoding utf8 -NoNewline

$persistRaw = curl.exe -s -X POST "$base/repost/persist" `
    -H "x-dev-user-id: u_tj_pic" -H "x-dev-dinas: TJ" -H "x-dev-role: PIC" `
    -F "rows=<$rowsFile" `
    -F "original_filename=06. DT TJ - Jun 2026.xlsx" `
    -F "description=persist verification test" `
    -F "file=@$fileTJ"

Write-Host $persistRaw

try {
    $persistResp = $persistRaw | ConvertFrom-Json
} catch {
    Write-Host "GAGAL persist -- response bukan JSON valid (lihat mentahnya di atas)." -ForegroundColor Red
    exit 1
}

if ($persistResp.data -and $persistResp.data.upload_id) {
    $uploadId = $persistResp.data.upload_id
} elseif ($persistResp.upload_id) {
    $uploadId = $persistResp.upload_id
} else {
    Write-Host "GAGAL persist -- tidak ada upload_id di response (kemungkinan error, lihat mentahnya di atas)." -ForegroundColor Red
    exit 1
}
Write-Host "`nupload_id: $uploadId" -ForegroundColor Green

Write-Host "`n=== STEP D: Cek DB langsung -- transaksi & kolom ===" -ForegroundColor Cyan
Write-Host "Jalanin manual:"
Write-Host "  psql -U postgres -h localhost -d rdt_persist_test -c `"SELECT count(*), status_konfirmasi FROM rdt.transactions WHERE upload_id=$uploadId GROUP BY status_konfirmasi;`""
Write-Host "  psql -U postgres -h localhost -d rdt_persist_test -c `"SELECT id, dinas_target, account, ref_doc, sheet_name, raw_row_index, category FROM rdt.transactions WHERE upload_id=$uploadId LIMIT 3;`""

Write-Host "`n=== STEP E: Ambil satu baris PENDING utk uji confirm ===" -ForegroundColor Cyan
Write-Host "  psql -U postgres -h localhost -d rdt_persist_test -c `"SELECT id, dinas_target FROM rdt.transactions WHERE upload_id=$uploadId AND status_konfirmasi='PENDING' LIMIT 1;`""
Write-Host "`nCatat id & dinas_target-nya (misal ID=101, DINAS=TE), lalu jalankan manual (ganti ID/DINAS):"
Write-Host '  curl.exe -s -X POST "http://localhost:3000/repost/confirmation/TE/submit" -H "x-dev-user-id: u_target_pic" -H "x-dev-dinas: TE" -H "x-dev-role: PIC" -H "Content-Type: application/json" -d "{\"decisions\":[{\"id\":101,\"claim\":\"YA\"}]}"'
Write-Host "`nLalu cek ledger:"
Write-Host '  psql -U postgres -h localhost -d rdt_persist_test -c "SELECT * FROM rdt.ledger_entries WHERE transaction_id=101;"'

Write-Host "`n=== SELESAI (STEP A-C otomatis). Lanjutkan D & E manual, lalu paste semua hasil. ===" -ForegroundColor Green
