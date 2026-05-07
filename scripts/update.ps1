param(
    [string]$TargetTag = ""
)

$ROOT = Split-Path -Parent $PSScriptRoot
$TASK = 'BakeryApp'
$python = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
$pip    = Join-Path $ROOT 'backend\venv\Scripts\pip.exe'
$npm    = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }

function Write-Log($msg, $color = 'White') {
    $ts = Get-Date -Format 'HH:mm:ss'
    Write-Host "[$ts] $msg" -ForegroundColor $color
}

Write-Host '=== Bakery - Update ===' -ForegroundColor Cyan

# Зчитуємо OAuth токен — спочатку з БД, потім з .git-credentials
$DATA_DIR   = 'C:\ProgramData\Bakery'
$dbPath     = Join-Path $DATA_DIR 'bakery.db'
$oauthToken = ''

# Спроба 1: з БД через sqlite3
if (Test-Path $dbPath) {
    try {
        $oauthToken = (& $python -c "import sqlite3; db=sqlite3.connect(r'$dbPath'); r=db.execute('SELECT value FROM settings WHERE key=?',('github_oauth_token',)).fetchone(); print(r[0] if r and r[0] else '',end=''); db.close()" 2>$null) -join '' | ForEach-Object { $_.Trim() }
    } catch {}
}

# Спроба 2: з .git-credentials (формат: https://x-access-token:TOKEN@github.com)
if (-not $oauthToken) {
    $credFile = Join-Path $env:USERPROFILE '.git-credentials'
    if (Test-Path $credFile) {
        $line = Get-Content $credFile | Where-Object { $_ -match 'github\.com' } | Select-Object -First 1
        if ($line -match 'x-access-token:([^@]+)@') { $oauthToken = $Matches[1].Trim() }
    }
}

if ($oauthToken) {
    Write-Log 'GitHub token: OK'
} else {
    Write-Log 'WARNING: GitHub token not found — update may fail for private repo' Yellow
}

$ghHeaders = @{ 'User-Agent' = 'BakeryUpdate/1.0' }
if ($oauthToken) { $ghHeaders['Authorization'] = "Bearer $oauthToken" }

# Resolve target tag
if (-not $TargetTag) {
    Write-Log 'Fetching latest tag from GitHub...'
    try {
        $tags = Invoke-RestMethod 'https://api.github.com/repos/TSOrest/Bakery/tags' -Headers $ghHeaders -TimeoutSec 10
        $TargetTag = $tags[0].name
    } catch {
        Write-Log "ERROR: Cannot reach GitHub: $_" Red
        Read-Host 'Press Enter'; exit 1
    }
}

$currentVersion = (Get-Content (Join-Path $ROOT 'VERSION') -ErrorAction SilentlyContinue).Trim()
Write-Log "Current: $currentVersion  ->  Target: $TargetTag"

if ($currentVersion -eq $TargetTag) {
    Write-Log 'Already up to date.' Green
    Read-Host 'Press Enter'; exit 0
}

# Save current version for rollback
Set-Content -Path (Join-Path $ROOT 'PREVIOUS_VERSION') -Value $currentVersion -Encoding UTF8

# Stop server
Write-Log 'Stopping server...' Yellow
Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Оновлюємо git credentials токеном акаунта пекарні (якщо авторизовано)
$oauthToken = & $python -c "
import sys; sys.path.insert(0, r'$ROOT')
from backend.database import engine
from backend.models.settings import Setting
from sqlalchemy.orm import Session
with Session(engine) as db:
    row = db.get(Setting, 'github_oauth_token')
    print(row.value if row and row.value else '', end='')
" 2>$null
if ($oauthToken) {
    [System.IO.File]::WriteAllText(
        (Join-Path $env:USERPROFILE '.git-credentials'),
        "https://x-access-token:$oauthToken@github.com`n",
        [System.Text.Encoding]::UTF8
    )
    & git -C $ROOT config credential.helper store | Out-Null
    Write-Log 'Git credentials updated from OAuth token'
}

# Бекап БД перед оновленням (атомарність — якщо щось зломається, можна відкатитись)
$DB_PATH = Join-Path $DATA_DIR 'bakery.db'
if (Test-Path $DB_PATH) {
    $backupName = "bakery_pre-update-$($currentVersion)-to-$($TargetTag)_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').db"
    $backupDir = Join-Path $DATA_DIR 'backups'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backupPath = Join-Path $backupDir $backupName
    try {
        Write-Log 'Creating pre-update DB backup...'
        # SQLite online backup через Python (через venv)
        & $python -c @"
import sqlite3, sys
src = sqlite3.connect(r'$DB_PATH')
src.execute('PRAGMA wal_checkpoint(TRUNCATE)')
dst = sqlite3.connect(r'$backupPath')
with dst:
    src.backup(dst)
dst.close(); src.close()
"@ 2>&1 | Out-Null
        if (Test-Path $backupPath) {
            Write-Log "  Pre-update backup: $backupName" Green
        }
    } catch {
        Write-Log "WARNING: pre-update backup failed: $_" Yellow
    }
}

# Git fetch and checkout
# Налаштування git щоб НЕ просив prompt (інакше зависає у фоновому процесі без TTY)
$env:GIT_TERMINAL_PROMPT = '0'

Write-Log 'Fetching from GitHub...'
# Тимчасово підставляємо URL з токеном — НЕ покладаємось на credential.helper
# (wincredman / .git-credentials можуть бути недоступні з фонового процесу).
$REPO_URL = 'https://github.com/TSOrest/Bakery.git'
if ($oauthToken) {
    $authUrl = "https://x-access-token:$oauthToken@github.com/TSOrest/Bakery.git"
    & git -C $ROOT remote set-url origin $authUrl 2>&1 | Out-Null
}
$gitResult = & git -C $ROOT fetch origin --tags 2>&1
$fetchExit = $LASTEXITCODE
# Прибираємо токен з origin URL — щоб не лишався у git config
if ($oauthToken) {
    & git -C $ROOT remote set-url origin $REPO_URL 2>&1 | Out-Null
}
if ($fetchExit -ne 0) {
    Write-Log "ERROR: git fetch failed: $gitResult" Red
    Read-Host 'Press Enter'; exit 1
}

Write-Log "Checking out $TargetTag..."
# Скидаємо локальні зміни — вони можуть блокувати checkout (напр. вручну замінені файли)
& git -C $ROOT reset --hard HEAD 2>&1 | Out-Null
& git -C $ROOT clean -fd 2>&1 | Out-Null
$gitResult = & git -C $ROOT checkout $TargetTag 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: git checkout failed: $gitResult" Red
    Read-Host 'Press Enter'; exit 1
}

# Update VERSION file (checkout may have overwritten it)
Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $TargetTag -Encoding UTF8

# Видаляємо dev-артефакти і логи з папки коду (якщо раптом потрапили після checkout)
Remove-Item -Path (Join-Path $ROOT 'logs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $ROOT 'dev')  -Recurse -Force -ErrorAction SilentlyContinue

# Install new Python dependencies
Write-Log 'Installing Python dependencies...'
& $pip install -r (Join-Path $ROOT 'backend\requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Log 'ERROR: pip install failed — rolling back to previous version' Red
    & git -C $ROOT checkout $currentVersion 2>&1 | Out-Null
    Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $currentVersion -Encoding UTF8
    Write-Log "Rolled back to $currentVersion" Yellow
    Read-Host 'Press Enter'; exit 1
}

# Run DB migrations
Write-Log 'Applying database migrations...'
$env:BAKERY_DATA_DIR = 'C:\ProgramData\Bakery'
$migResult = & $python -c "
import sys, os
os.environ['BAKERY_DATA_DIR'] = r'C:\ProgramData\Bakery'
sys.path.insert(0, r'$($ROOT.Replace('\','\\'))')
os.chdir(r'$($ROOT.Replace('\','\\'))')
from backend.database import engine, Base
import backend.models.references, backend.models.orders, backend.models.pricing
import backend.models.baking, backend.models.invoices, backend.models.movements
import backend.models.finances, backend.models.shop, backend.models.settings, backend.models.auth
Base.metadata.create_all(engine)
import sqlite3, pathlib
db = sqlite3.connect(str(pathlib.Path(r'C:\ProgramData\Bakery') / 'bakery.db'))
mig_dir = pathlib.Path(r'$($ROOT.Replace('\','\\'))') / 'database' / 'migrations'
if mig_dir.exists():
    for f in sorted(mig_dir.glob('*.sql')):
        for stmt in f.read_text('utf-8').split(';'):
            stmt = '\n'.join(l for l in stmt.splitlines() if not l.strip().startswith('--')).strip()
            if stmt:
                try: db.execute(stmt)
                except: pass
        db.commit()
db.close()
print('Migrations OK')
" 2>&1
Write-Log $migResult

# Build frontend — спочатку завантажуємо готовий dist з release assets,
# якщо недоступно — збираємо локально через npm.
Write-Log 'Building frontend...' Yellow

$SAFE_TEMP     = 'C:\Windows\Temp'
$distDownloaded = $false

if ($oauthToken) {
    try {
        $apiHdrs = @{ Authorization="Bearer $oauthToken"; 'User-Agent'='BakeryApp-Updater/1.0'; Accept='application/vnd.github+json' }
        $relInfo  = Invoke-WebRequest "https://api.github.com/repos/TSOrest/Bakery/releases/tags/$TargetTag" `
            -UseBasicParsing -Headers $apiHdrs | ConvertFrom-Json
        $distAsset = $relInfo.assets | Where-Object { $_.name -eq 'frontend-dist.zip' } | Select-Object -First 1
        if ($distAsset) {
            Write-Log "  Завантаження frontend-dist.zip ($([Math]::Round($distAsset.size/1MB,1)) MB)..."
            $distZip    = "$SAFE_TEMP\bakery-frontend-dist.zip"
            $distTarget = Join-Path $ROOT 'frontend\dist'
            $dlHdrs = $apiHdrs.Clone(); $dlHdrs['Accept'] = 'application/octet-stream'
            Invoke-WebRequest $distAsset.url -OutFile $distZip -UseBasicParsing -Headers $dlHdrs
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            if (Test-Path $distTarget) { Remove-Item $distTarget -Recurse -Force }
            New-Item -ItemType Directory -Path $distTarget -Force | Out-Null
            [System.IO.Compression.ZipFile]::ExtractToDirectory($distZip, $distTarget)
            Remove-Item $distZip -Force -ErrorAction SilentlyContinue
            $distDownloaded = $true
            Write-Log '  Фронтенд завантажено з release assets' Green
        }
    } catch {
        Write-Log "  dist download failed: $_ — спробуємо npm" Yellow
    }
}

if (-not $distDownloaded) {
    $env:npm_config_cache = "$SAFE_TEMP\npm-cache"
    $build = Start-Process -FilePath $npm -ArgumentList 'run build' `
        -WorkingDirectory (Join-Path $ROOT 'frontend') -Wait -PassThru
    if ($build.ExitCode -ne 0) {
        Write-Log 'ERROR: Frontend build failed.' Red
        & git -C $ROOT checkout $currentVersion 2>&1 | Out-Null
        Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $currentVersion -Encoding UTF8
        Read-Host 'Press Enter'; exit 1
    }
}

# Regenerate run-server.ps1 in ProgramData (not in git, must be updated manually on each update)
Write-Log 'Regenerating run-server.ps1...'
$dataScriptsDir = 'C:\ProgramData\Bakery\scripts'
New-Item -ItemType Directory -Path $dataScriptsDir -Force | Out-Null
$runServerPath = "$dataScriptsDir\run-server.ps1"
$rootQ   = $ROOT.Replace("'", "''")
$pythonQ = $python.Replace("'", "''")
$serverScript = @"
# Bakery server launcher — auto-generated by update.ps1
`$env:BAKERY_DATA_DIR = 'C:\ProgramData\Bakery'
`$log    = 'C:\ProgramData\Bakery\logs\bakery.log'
`$python = '$pythonQ'

`$portBusy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (`$portBusy) {
    Add-Content `$log ("[" + (Get-Date -Format 'HH:mm:ss') + "]  WARNING: port 8000 busy (PID `$(`$portBusy.OwningProcess)), stopping...")
    Stop-Process -Id `$portBusy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Add-Content `$log ("\`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$rootQ'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
"@
Set-Content $runServerPath $serverScript -Encoding UTF8
Write-Log "run-server.ps1 updated: $runServerPath"

# Regenerate run-tray.ps1 in ProgramData (same pattern as run-server.ps1)
$runTrayPath = "$dataScriptsDir\run-tray.ps1"
$trayScript = @"
# Bakery tray watchdog — auto-generated by update.ps1
`$env:BAKERY_DATA_DIR = 'C:\ProgramData\Bakery'
`$ROOT       = '$rootQ'
`$pythonw    = Join-Path `$ROOT 'backend\venv\Scripts\pythonw.exe'
`$trayScript = Join-Path `$ROOT 'tray.py'

while (`$true) {
    if (Test-Path `$pythonw) {
        & `$pythonw `$trayScript
    }
    Start-Sleep -Seconds 5
}
"@
Set-Content $runTrayPath $trayScript -Encoding UTF8
Write-Log "run-tray.ps1 updated: $runTrayPath"

# Restart server — спочатку повністю зупиняємо задачу щоб скинути стан "в черзі"
Write-Log 'Starting server...' Yellow
Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $TASK
} else {
    Start-Process -FilePath $python `
        -ArgumentList '-m uvicorn backend.main:app --host 0.0.0.0 --port 8000' `
        -WorkingDirectory $ROOT -WindowStyle Hidden
}

# Relaunch tray через Task Scheduler (watchdog сам підніме потрібний екземпляр)
# НЕ запускаємо pythonw напряму — інакше watchdog теж запустить і буде два екземпляри
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Stop-ScheduledTask  -TaskName 'BakeryTray' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'BakeryTray' -ErrorAction SilentlyContinue

# Оновлюємо версію в реєстрі (Програми та компоненти)
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bakery'
if (Test-Path $regPath) {
    Set-ItemProperty $regPath 'DisplayVersion' $TargetTag -ErrorAction SilentlyContinue
}

Write-Log "Update complete: $TargetTag" Green
Write-Host ''
Write-Host "  Version: $TargetTag"
Write-Host "  Rollback: run rollback.bat to revert to $currentVersion"
Write-Host ''
Start-Sleep -Seconds 2

