$ROOT = Split-Path -Parent $PSScriptRoot
$TASK = 'BakeryApp'

Write-Host '=== Bakery — Start ===' -ForegroundColor Cyan

# Kill old processes first
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object {
        $conns = Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue
        $conns | Where-Object { $_.LocalPort -in @(5173, 5174) }
    } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

$python = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'ERROR: venv not found. Run install.bat first.' -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
}

# If task is registered — use it (handles logging + restart on crash)
$task = Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Starting via Task Scheduler ($TASK)..."
    Start-ScheduledTask -TaskName $TASK
} else {
    # Fallback: build frontend and run directly
    $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }

    Write-Host 'Building frontend...' -ForegroundColor Yellow
    $build = Start-Process -FilePath $npm `
        -ArgumentList 'run build' `
        -WorkingDirectory (Join-Path $ROOT 'frontend') `
        -WindowStyle Hidden -Wait -PassThru

    if ($build.ExitCode -ne 0) {
        Write-Host 'ERROR: Frontend build failed.' -ForegroundColor Red
        Read-Host 'Press Enter'; exit 1
    }

    Write-Host 'Starting server directly...'
    Start-Process -FilePath $python `
        -ArgumentList '-m uvicorn backend.main:app --host 0.0.0.0 --port 8000' `
        -WorkingDirectory $ROOT `
        -WindowStyle Normal
}

Start-Sleep -Seconds 4

$status = try {
    (Invoke-WebRequest 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode
} catch { 0 }

if ($status -eq 200) {
    Write-Host 'Server: OK' -ForegroundColor Green
    Start-Process 'http://localhost:8000'
} else {
    Write-Host 'Server starting... open http://localhost:8000 in a moment.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  App:  http://localhost:8000'
Write-Host '  API:  http://localhost:8000/api/docs'
if ($task) { Write-Host '  Logs: logs\bakery.log' }
Write-Host ''
