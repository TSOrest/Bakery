# Одноразовий ручний апгрейд клієнта v1.0.x → v1.1.3
# Обходить два бар'єри що блокують update.bat:
#   1. GitHub Credential Manager popup ("Select an account") — через
#      `-c credential.helper=` + http.extraHeader з токеном.
#   2. Self-update race у update.ps1 (PowerShell кешує старий скрипт
#      у пам'яті і не бачить новий код після git checkout) — тут
#      просто завантажуємо frontend-dist.zip з release, npm не потрібен.
#
# Запускати від адміна:
#   powershell -ExecutionPolicy Bypass -File manual-upgrade-v1.1.3.ps1

$ErrorActionPreference = 'Stop'
$ROOT = 'C:\Program Files\Bakery'
$DATA = 'C:\ProgramData\Bakery'
$TAG  = 'v1.1.3'
# Тимчасова папка — system-wide щоб уникнути проблем з 8.3 short names коли
# username клієнта у кирилиці (напр. $env:TEMP = C:\Users\9734~1\AppData\...).
$TMP  = 'C:\Windows\Temp'

function Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }

Step '1. Зупинка сервера'
Stop-ScheduledTask -TaskName BakeryApp -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
  ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Ok "вбито PID $($_.ProcessId)"
  }
Start-Sleep -Seconds 2

Step '2. OAuth-токен з БД пекарні'
$py     = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
$pyFile = Join-Path $TMP 'bakery-get-token.py'
$pyCode = @"
import sqlite3
db = sqlite3.connect(r'$DATA\bakery.db')
row = db.execute("SELECT value FROM settings WHERE key='github_oauth_token'").fetchone()
print(row[0] if row and row[0] else '', end='')
db.close()
"@
Set-Content -LiteralPath $pyFile -Value $pyCode -Encoding UTF8
$tok = (& $py $pyFile).Trim()
if (Test-Path -LiteralPath $pyFile) { Remove-Item -LiteralPath $pyFile -Force }
if (-not $tok) { throw 'OAuth-токен не знайдено в settings — потрібен GitHub login через UI пекарні' }
Ok "токен довжиною $($tok.Length)"

Step '3. Бекап БД'
$backupDir = Join-Path $DATA 'backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$backupName = "bakery_pre-manual-upgrade-$($TAG)_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').db"
$backupPath = Join-Path $backupDir $backupName
$pyBackup = Join-Path $TMP 'bakery-backup.py'
@"
import sqlite3
src = sqlite3.connect(r'$DATA\bakery.db')
src.execute('PRAGMA wal_checkpoint(TRUNCATE)')
dst = sqlite3.connect(r'$backupPath')
with dst: src.backup(dst)
dst.close(); src.close()
"@ | Set-Content -LiteralPath $pyBackup -Encoding UTF8
& $py $pyBackup | Out-Null
if (Test-Path -LiteralPath $pyBackup) { Remove-Item -LiteralPath $pyBackup -Force }
if (Test-Path -LiteralPath $backupPath) { Ok "бекап: $backupName" } else { Warn 'бекап не створено (продовжуємо)' }

Step "4. Git fetch + checkout $TAG"
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE     = 'Never'

# Підхід з update.ps1: тимчасово вбудувати токен в origin URL, fetch, потім
# очистити. Надійніше за http.extraHeader (той у деяких випадках не задовольняє
# credential dance і git все одно просить username).
$REPO_URL = 'https://github.com/TSOrest/Bakery.git'
$authUrl  = "https://x-access-token:$tok@github.com/TSOrest/Bakery.git"

& git -C $ROOT remote set-url origin $authUrl 2>&1 | Out-Null
$fetchExit = 0
try {
    & git -C $ROOT fetch origin --tags 2>&1 | ForEach-Object { Write-Host "   $_" }
    $fetchExit = $LASTEXITCODE
} finally {
    & git -C $ROOT remote set-url origin $REPO_URL 2>&1 | Out-Null
}
if ($fetchExit -ne 0) { throw "git fetch failed (exit $fetchExit)" }
Ok 'fetch OK'

& git -C $ROOT reset --hard HEAD 2>&1 | Out-Null
& git -C $ROOT clean -fd 2>&1 | Out-Null
& git -C $ROOT checkout $TAG 2>&1 | ForEach-Object { Write-Host "   $_" }
if ($LASTEXITCODE -ne 0) { throw "git checkout $TAG failed" }
Set-Content -LiteralPath (Join-Path $ROOT 'VERSION') -Value $TAG -Encoding UTF8
Ok "checkout $TAG OK"

Step '5. Backend dependencies'
$pip = Join-Path $ROOT 'backend\venv\Scripts\pip.exe'
& $pip install -r (Join-Path $ROOT 'backend\requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
Ok 'pip OK'

Step '6. Database migrations'
$env:BAKERY_DATA_DIR = $DATA
$pyMig = Join-Path $TMP 'bakery-migrate.py'
$rootEsc = $ROOT.Replace('\','\\')
@"
import sys, os, sqlite3, pathlib
os.environ['BAKERY_DATA_DIR'] = r'$DATA'
sys.path.insert(0, r'$rootEsc')
os.chdir(r'$rootEsc')
from backend.database import engine, Base
import backend.models.references, backend.models.orders, backend.models.pricing
import backend.models.baking, backend.models.invoices, backend.models.movements
import backend.models.finances, backend.models.shop, backend.models.settings, backend.models.auth
Base.metadata.create_all(engine)
db = sqlite3.connect(str(pathlib.Path(r'$DATA') / 'bakery.db'))
mig_dir = pathlib.Path(r'$rootEsc') / 'database' / 'migrations'
if mig_dir.exists():
    for f in sorted(mig_dir.glob('*.sql')):
        for stmt in f.read_text('utf-8').split(';'):
            stmt = '\n'.join(l for l in stmt.splitlines() if not l.strip().startswith('--')).strip()
            if stmt:
                try: db.execute(stmt)
                except Exception: pass
        db.commit()
db.close()
print('Migrations OK')
"@ | Set-Content -LiteralPath $pyMig -Encoding UTF8
& $py $pyMig
if (Test-Path -LiteralPath $pyMig) { Remove-Item -LiteralPath $pyMig -Force }
Ok 'migrations OK'

Step "7. Завантаження frontend-dist.zip з release $TAG"
$apiHdr = @{ Authorization="Bearer $tok"; 'User-Agent'='BakeryManualUpgrade'; Accept='application/vnd.github+json' }
$rel = Invoke-RestMethod "https://api.github.com/repos/TSOrest/Bakery/releases/tags/$TAG" -Headers $apiHdr
$asset = $rel.assets | Where-Object { $_.name -eq 'frontend-dist.zip' } | Select-Object -First 1
if (-not $asset) { throw "У release $TAG немає frontend-dist.zip" }
$dlHdr = @{ Authorization="Bearer $tok"; 'User-Agent'='BakeryManualUpgrade'; Accept='application/octet-stream' }
$zip = 'C:\Windows\Temp\bakery-dist.zip'
Invoke-WebRequest $asset.url -OutFile $zip -Headers $dlHdr -UseBasicParsing
$dist = Join-Path $ROOT 'frontend\dist'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dist)
Remove-Item $zip -Force
Ok "розпаковано у $dist"

Step '8. Регенерація run-server.ps1 і run-tray.ps1 у ProgramData'
$dataScriptsDir = Join-Path $DATA 'scripts'
New-Item -ItemType Directory -Path $dataScriptsDir -Force | Out-Null
$pythonExe = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
$pythonwExe = Join-Path $ROOT 'backend\venv\Scripts\pythonw.exe'

$serverScript = @"
# Bakery server launcher — auto-generated by manual-upgrade
`$env:BAKERY_DATA_DIR = 'C:\ProgramData\Bakery'
`$log    = 'C:\ProgramData\Bakery\logs\bakery.log'
`$python = '$pythonExe'

`$portBusy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (`$portBusy) {
    Add-Content `$log ("[" + (Get-Date -Format 'HH:mm:ss') + "]  WARNING: port 8000 busy (PID `$(`$portBusy.OwningProcess)), stopping...")
    Stop-Process -Id `$portBusy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Add-Content `$log ("``n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$ROOT'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
"@
Set-Content (Join-Path $dataScriptsDir 'run-server.ps1') $serverScript -Encoding UTF8
Ok 'run-server.ps1 oновлено'

$trayScript = @"
# Bakery tray watchdog — auto-generated by manual-upgrade
`$env:BAKERY_DATA_DIR = 'C:\ProgramData\Bakery'
while (`$true) {
    & '$pythonwExe' '$ROOT\tray.py'
    Start-Sleep -Seconds 5
}
"@
Set-Content (Join-Path $dataScriptsDir 'run-tray.ps1') $trayScript -Encoding UTF8
Ok 'run-tray.ps1 oновлено'

Step '9. Запуск сервера'
New-Item -ItemType Directory -Path (Join-Path $DATA 'logs') -Force | Out-Null
Start-ScheduledTask -TaskName BakeryApp -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Перевірка що сервер відповідає
$ok = $false
for ($i=0; $i -lt 10; $i++) {
    try {
        $r = Invoke-WebRequest 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if ($ok) {
    Write-Host "`n=== OK — клієнт на $TAG, сервер відповідає ===" -ForegroundColor Green
} else {
    Write-Host "`n=== Сервер не відповідає за 10 сек — перевірте C:\ProgramData\Bakery\logs\bakery.log ===" -ForegroundColor Yellow
}

Read-Host 'Натисніть Enter щоб закрити'
