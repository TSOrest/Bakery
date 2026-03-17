$ROOT = Split-Path -Parent $PSScriptRoot
$TASK = 'BakeryApp'
$python = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
$pip    = Join-Path $ROOT 'backend\venv\Scripts\pip.exe'
$npm    = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }

Write-Host '=== Bakery - Rollback ===' -ForegroundColor Cyan

$prevFile = Join-Path $ROOT 'PREVIOUS_VERSION'
if (-not (Test-Path $prevFile)) {
    Write-Host 'ERROR: No previous version found. Nothing to roll back to.' -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
}

$prevVersion    = (Get-Content $prevFile).Trim()
$currentVersion = (Get-Content (Join-Path $ROOT 'VERSION') -ErrorAction SilentlyContinue).Trim()

Write-Host "Rolling back: $currentVersion -> $prevVersion"

# Stop server
Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Checkout previous version
$gitResult = & git -C $ROOT checkout $prevVersion 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git checkout $prevVersion failed: $gitResult" -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
}

Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $prevVersion -Encoding UTF8
Remove-Item $prevFile -ErrorAction SilentlyContinue

# Restore dependencies
& $pip install -r (Join-Path $ROOT 'backend\requirements.txt') --quiet

# Rebuild frontend
Write-Host 'Building frontend...' -ForegroundColor Yellow
$build = Start-Process -FilePath $npm `
    -ArgumentList 'run build' `
    -WorkingDirectory (Join-Path $ROOT 'frontend') `
    -WindowStyle Hidden -Wait -PassThru

if ($build.ExitCode -ne 0) {
    Write-Host 'ERROR: Frontend build failed.' -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
}

# Restart server
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

Write-Host "Rollback complete: $prevVersion" -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 2
