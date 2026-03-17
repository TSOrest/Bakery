$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host "Stopping old processes..."

# Kill all Python processes running uvicorn
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like "python*" -and $_.CommandLine -like "*uvicorn*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Kill node processes on Vite ports
Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object {
        $conns = Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue
        $conns | Where-Object { $_.LocalPort -in @(5173, 5174) }
    } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

# Backend
$python = Join-Path $ROOT "backend\venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "ERROR: venv not found. Run install.bat first." -ForegroundColor Red
    Read-Host "Press Enter"
    exit 1
}

Write-Host "Starting backend on port 8000..."
Start-Process -FilePath $python `
    -ArgumentList "-m uvicorn backend.main:app --host 0.0.0.0 --port 8000" `
    -WorkingDirectory $ROOT `
    -WindowStyle Normal
Start-Sleep -Seconds 2

# Frontend
Write-Host "Starting frontend on port 5173..."
$npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = "C:\Program Files\nodejs\npm.cmd" }
$env:CHOKIDAR_USEPOLLING = "1"
Start-Process -FilePath $npm `
    -ArgumentList "run dev -- --host 0.0.0.0" `
    -WorkingDirectory (Join-Path $ROOT "frontend") `
    -WindowStyle Normal

Start-Sleep -Seconds 4

$backend = try { (Invoke-WebRequest http://localhost:8000/api/health -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }
if ($backend -eq 200) {
    Write-Host "Backend: OK" -ForegroundColor Green
} else {
    Write-Host "Backend: starting..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Frontend:  http://localhost:5173"
Write-Host "  Backend:   http://localhost:8000"
Write-Host ""
