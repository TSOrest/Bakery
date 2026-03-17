$ROOT = Split-Path -Parent $PSScriptRoot
$TASK = 'BakeryApp'

Write-Host '=== Bakery - Install Auto-Start ===' -ForegroundColor Cyan

# Check venv
$python = Join-Path $ROOT 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'ERROR: venv not found. Run install.bat first.' -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
}

# Create logs directory
$logsDir = Join-Path $ROOT 'logs'
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# Build frontend
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
Write-Host 'Frontend built OK.' -ForegroundColor Green

# Remove old task if exists
Unregister-ScheduledTask -TaskName $TASK -Confirm:$false -ErrorAction SilentlyContinue

# Wrapper script that logs uvicorn output
$runnerPath = Join-Path $ROOT 'scripts\run-server.ps1'
$rootEsc = $ROOT.Replace('\','\\')
$pythonEsc = $python.Replace('\','\\')
$runnerContent = @"
`$log = Join-Path '$rootEsc' 'logs\bakery.log'
`$python = '$pythonEsc'
Add-Content `$log ("`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log `$_ }
"@
Set-Content -Path $runnerPath -Value $runnerContent -Encoding UTF8

# Register scheduled task
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`"" `
    -WorkingDirectory $ROOT

$trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TASK `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Bakery app server - auto-start at logon' `
    -Force | Out-Null

Write-Host ('Task ' + $TASK + ' registered - starts automatically at logon.') -ForegroundColor Green

# Stop any existing process and start via task
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host 'Starting server...' -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TASK
Start-Sleep -Seconds 5

$status = try {
    (Invoke-WebRequest 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode
} catch { 0 }

if ($status -eq 200) {
    Write-Host 'Server: OK' -ForegroundColor Green
} else {
    Write-Host 'Server starting... check http://localhost:8000 in a moment.' -ForegroundColor Yellow
}

# Launch tray icon (kill old instance first)
$pythonw = Join-Path $ROOT 'backend\venv\Scripts\pythonw.exe'
$trayScript = Join-Path $ROOT 'tray.py'
Get-Process -Name pythonw -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Start-Process -FilePath $pythonw -ArgumentList "`"$trayScript`"" -WorkingDirectory $ROOT -WindowStyle Hidden

Write-Host ''
Write-Host '  Auto-start: ON (runs at every login)'
Write-Host '  Tray icon:  active in system tray'
Write-Host '  Logs:       logs\bakery.log'
Write-Host '  App:        http://localhost:8000'
Write-Host ''
