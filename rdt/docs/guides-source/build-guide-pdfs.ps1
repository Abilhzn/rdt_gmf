# build-guide-pdfs.ps1
# Convert semua HTML panduan fitur (rdt/docs/guides-source/*.html) jadi PDF, disimpan langsung
# ke rdt/frontend/rdt/assets/guides/ (folder assets Angular - otomatis ter-serve runtime di
# path /assets/guides/*.pdf begitu dev-shell di-restart/rebuild).
#
# Cara pakai:
#   cd E:\_tadashi\project\budgeting_gmf\rdt\docs\guides-source
#   .\build-guide-pdfs.ps1
#
# Butuh Google Chrome terinstall (dipakai headless, cuma buat convert HTML ke PDF, tak perlu
# koneksi apa pun). Jalankan ulang script ini kapan saja isi guides-source .html diedit.
# Aman dijalankan walau Chrome biasa sedang terbuka, pakai profile sementara terpisah
# (user-data-dir) khusus untuk sesi headless ini, tak menyentuh profile Chrome utama Anda.

$ErrorActionPreference = "Stop"

$sourceDir = $PSScriptRoot
$outputDir = Join-Path $sourceDir "..\..\frontend\rdt\assets\guides"
$tempProfile = Join-Path $env:TEMP "rdt-guide-pdf-chrome-profile"

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
    Write-Host "GAGAL: chrome.exe tidak ditemukan di lokasi umum." -ForegroundColor Red
    Write-Host "Edit variabel chrome di script ini, isi manual dengan path lengkap ke chrome.exe Anda." -ForegroundColor Yellow
    exit 1
}

Write-Host "Pakai Chrome: $chrome" -ForegroundColor Cyan
Write-Host "Source : $sourceDir"
Write-Host "Output : $outputDir"
Write-Host ""

$htmlFiles = Get-ChildItem -Path $sourceDir -Filter "*.html"
$count = 0

foreach ($file in $htmlFiles) {
    $pdfName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + ".pdf"
    $pdfPath = Join-Path $outputDir $pdfName
    $fileUrl = "file:///" + ($file.FullName -replace '\\', '/')

    Write-Host ("-> " + $file.Name + "  =>  guides/" + $pdfName)

    $output = & $chrome `
        "--headless=new" `
        "--disable-gpu" `
        "--no-sandbox" `
        "--user-data-dir=$tempProfile" `
        "--print-to-pdf=$pdfPath" `
        "--print-to-pdf-no-header" `
        "--virtual-time-budget=5000" `
        $fileUrl 2>&1

    if (Test-Path $pdfPath) {
        $count++
    } else {
        Write-Host ("   GAGAL convert " + $file.Name + " - output Chrome:") -ForegroundColor Red
        Write-Host "   $output" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host ("Selesai: " + $count + " / " + $htmlFiles.Count + " PDF berhasil dibuat di " + $outputDir) -ForegroundColor Green
if ($count -eq $htmlFiles.Count) {
    Write-Host "Restart 'npm start' di rdt/frontend/dev-shell/ supaya asset baru ini ke-pickup." -ForegroundColor Yellow
}
