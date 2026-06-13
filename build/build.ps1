# ── CamLink · build completo (eseguibile + installer) ───────────────────────
#
# Produce:
#   1) build\dist\CamLink\CamLink.exe   (app windowless, con tray)
#   2) installer\output\CamLink-Setup.exe   (installer wizard)
#
# Uso:  powershell -ExecutionPolicy Bypass -File build\build.ps1
#
# Requisiti: Python con le dipendenze (requirements.txt). PyInstaller e Inno
# Setup vengono installati automaticamente se mancano (Inno via winget).

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "[1/4] Dipendenze build..." -ForegroundColor Cyan
python -m pip install --upgrade pyinstaller pillow pystray | Out-Null

Write-Host "[2/4] Generazione icona..." -ForegroundColor Cyan
python build\make_icon.py

Write-Host "[3/4] Build eseguibile (PyInstaller)..." -ForegroundColor Cyan
python -m PyInstaller `
  --noconfirm --clean --windowed `
  --name CamLink `
  --icon "$root\assets\icon.ico" `
  --distpath build\dist --workpath build\work --specpath build `
  --add-data "$root\web;web" `
  --add-data "$root\assets;assets" `
  --collect-all aiortc `
  --collect-all av `
  --collect-all aioice `
  --collect-all pyvirtualcam `
  --collect-all pystray `
  --collect-submodules cryptography `
  --hidden-import qrcode.image.svg `
  --hidden-import PIL._tkinter_finder `
  server.py

if (-not (Test-Path "build\dist\CamLink\CamLink.exe")) {
  throw "Build PyInstaller fallita."
}

Write-Host "[4/4] Creazione installer (Inno Setup)..." -ForegroundColor Cyan
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  foreach ($g in @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
      "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $g) { $iscc = $g; break }
  }
}
if (-not $iscc) {
  Write-Host "  Inno Setup non trovato: provo a installarlo con winget..." -ForegroundColor Yellow
  try {
    winget install -e --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements | Out-Null
    $guess = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (Test-Path $guess) { $iscc = $guess }
  } catch {}
}

$versionMatch = Select-String -Path "server.py" -Pattern 'VERSION\s*=\s*"([^"]+)"'
$version = if ($versionMatch) { $versionMatch.Matches[0].Groups[1].Value } else { "1.0.0" }
Write-Host "  Versione: $version" -ForegroundColor Cyan

if ($iscc) {
  & $iscc "/DAppVersion=$version" "installer\CamLink.iss"
  Write-Host ""
  Write-Host "FATTO!" -ForegroundColor Green
  Write-Host "  Installer:  installer\output\CamLink-Setup.exe  (v$version)" -ForegroundColor Green
  Write-Host "  Mandalo agli amici: doppio click e installano tutto." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Eseguibile pronto in build\dist\CamLink\" -ForegroundColor Green
  Write-Host "Per l'installer installa Inno Setup (https://jrsoftware.org/isdl.php)" -ForegroundColor Yellow
  Write-Host "poi esegui:  iscc installer\CamLink.iss" -ForegroundColor Yellow
}
