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

# Зчитуємо OAuth токен з БД заздалегідь — потрібен для приватного репо
$DATA_DIR   = 'C:\ProgramData\Bakery'
$dbPath     = Join-Path $DATA_DIR 'bakery.db'
$oauthToken = ''
if (Test-Path $dbPath) {
    try {
        $oauthToken = & $python -c "
import sqlite3
db = sqlite3.connect(r'$($dbPath.Replace("'","''"))')
row = db.execute(\"SELECT value FROM settings WHERE key='github_oauth_token'\").fetchone()
print(row[0] if row and row[0] else '', end='')
db.close()
" 2>$null
    } catch {}
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

# Git fetch and checkout
Write-Log 'Fetching from GitHub...'
$gitResult = & git -C $ROOT fetch origin --tags 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: git fetch failed: $gitResult" Red
    Read-Host 'Press Enter'; exit 1
}

Write-Log "Checking out $TargetTag..."
$gitResult = & git -C $ROOT checkout $TargetTag 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: git checkout failed: $gitResult" Red
    Read-Host 'Press Enter'; exit 1
}

# Update VERSION file (checkout may have overwritten it)
Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $TargetTag -Encoding UTF8

# Install new Python dependencies
Write-Log 'Installing Python dependencies...'
& $pip install -r (Join-Path $ROOT 'backend\requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Log 'WARNING: pip install had errors (continuing)' Yellow
}

# Build frontend
Write-Log 'Building frontend...' Yellow
$build = Start-Process -FilePath $npm `
    -ArgumentList 'run build' `
    -WorkingDirectory (Join-Path $ROOT 'frontend') `
    -WindowStyle Hidden -Wait -PassThru

if ($build.ExitCode -ne 0) {
    Write-Log 'ERROR: Frontend build failed.' Red
    # Rollback
    & git -C $ROOT checkout $currentVersion 2>&1 | Out-Null
    Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $currentVersion -Encoding UTF8
    Read-Host 'Press Enter'; exit 1
}

# Restart server
Write-Log 'Starting server...' Yellow
if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $TASK
} else {
    Start-Process -FilePath $python `
        -ArgumentList '-m uvicorn backend.main:app --host 0.0.0.0 --port 8000' `
        -WorkingDirectory $ROOT -WindowStyle Hidden
}

# Relaunch tray
$pythonw = Join-Path $ROOT 'backend\venv\Scripts\pythonw.exe'
$trayScript = Join-Path $ROOT 'tray.py'
Get-Process -Name pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process -FilePath $pythonw -ArgumentList "`"$trayScript`"" -WorkingDirectory $ROOT -WindowStyle Hidden

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

