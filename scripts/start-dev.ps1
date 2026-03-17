$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host '=== Bakery — Dev Mode ===' -ForegroundColor Magenta

# Kill old uvicorn processes
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Kill Vite node processes
Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object {
        $conns = Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue
        $conns | Where-Object { $_.LocalPort -in @(5173, 5174) }
    } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

$python = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'ERROR: venv not found.' -ForegroundColor Red
    Read-Host 'Press Enter'
    exit 1
}

# Backend with hot-reload
Write-Host 'Starting backend with hot-reload on port 8000...' -ForegroundColor Green
Start-Process -FilePath $python `
    -ArgumentList '-m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload' `
    -WorkingDirectory $ROOT `
    -WindowStyle Normal
Start-Sleep -Seconds 2

# Vite dev server
$npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }
$env:CHOKIDAR_USEPOLLING = '1'
Write-Host 'Starting Vite dev server on port 5173...' -ForegroundColor Green
Start-Process -FilePath $npm `
    -ArgumentList 'run dev -- --host 0.0.0.0' `
    -WorkingDirectory (Join-Path $ROOT 'frontend') `
    -WindowStyle Normal

Write-Host ''
Write-Host '  UI (HMR): http://localhost:5173'
Write-Host '  API docs: http://localhost:8000/api/docs'
Write-Host ''
