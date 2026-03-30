$ROOT      = Split-Path -Parent $PSScriptRoot
$TASK      = 'BakeryApp'
$DATA_DIR  = 'C:\ProgramData\Bakery'
$REG_PATH  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bakery'

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

# Генеруємо run-server.ps1 в ProgramData (не в папці коду — переживає перевстановлення)
$dataScriptsDir = "$DATA_DIR\scripts"
New-Item -ItemType Directory -Path $dataScriptsDir -Force | Out-Null
New-Item -ItemType Directory -Path "$DATA_DIR\logs" -Force | Out-Null
$runnerPath = "$dataScriptsDir\run-server.ps1"

$rootEsc    = $ROOT.Replace("'", "''")
$pythonEsc  = $python.Replace("'", "''")
$dataDirEsc = $DATA_DIR.Replace("'", "''")
$runnerContent = @"
`$env:BAKERY_DATA_DIR = '$dataDirEsc'
`$log    = '$dataDirEsc\logs\bakery.log'
`$python = '$pythonEsc'

# Перевірка: якщо порт 8000 вже зайнятий — вбиваємо той процес
`$portBusy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (`$portBusy) {
    Add-Content `$log ("`n[" + (Get-Date -Format 'HH:mm:ss') + "]  ПОПЕРЕДЖЕННЯ: порт 8000 зайнятий (PID `$(`$portBusy.OwningProcess)), звільняємо...")
    Stop-Process -Id `$portBusy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

taskkill /F /IM python.exe /T 2>`$null
Start-Sleep -Seconds 1
Add-Content `$log ("`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$rootEsc'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
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

# ── Register tray task ────────────────────────────────────────────────────────
# Uses run-tray.ps1 watchdog (infinite loop) — tray restarts 5 sec after any
# exit (user clicked Exit, crash, update). Task Scheduler only stops it via
# Stop-ScheduledTask (RestartCount is irrelevant since the task never ends).
$TRAY_TASK  = 'BakeryTray'
$trayRunner = Join-Path $ROOT 'scripts\run-tray.ps1'

Unregister-ScheduledTask -TaskName $TRAY_TASK -Confirm:$false -ErrorAction SilentlyContinue

$trayAction = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayRunner`"" `
    -WorkingDirectory $ROOT

$trayTrigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME

$traySettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TRAY_TASK `
    -Action $trayAction `
    -Trigger $trayTrigger `
    -Settings $traySettings `
    -Principal $principal `
    -Description 'Bakery tray watchdog - auto-start at logon, restarts tray after exit' `
    -Force | Out-Null

Write-Host ('Task ' + $TRAY_TASK + ' registered - tray starts automatically at logon.') -ForegroundColor Green

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

# Launch tray icon via Task Scheduler (kill old instance first)
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Start-ScheduledTask -TaskName $TRAY_TASK

# Правило брандмауера (доступ з локальної мережі на порт 8000)
$null = netsh advfirewall firewall show rule name="BakeryApp" 2>$null
if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule name="BakeryApp" dir=in action=allow protocol=TCP localport=8000 profile=private 2>$null | Out-Null
}
Write-Host 'Firewall: port 8000 open for private network.' -ForegroundColor Green

# Оновлюємо версію в реєстрі (якщо запис вже є)
$version = if (Test-Path "$ROOT\VERSION") { (Get-Content "$ROOT\VERSION" -Encoding UTF8).Trim().TrimStart([char]0xFEFF) } else { '1.0' }
if (Test-Path $REG_PATH) {
    Set-ItemProperty $REG_PATH 'DisplayVersion' $version -ErrorAction SilentlyContinue
    Write-Host "Registry version updated: $version" -ForegroundColor Green
}

Write-Host ''
Write-Host '  Auto-start: ON (runs at every login)'
Write-Host '  Tray icon:  active in system tray'
Write-Host '  Logs:       logs\bakery.log'
Write-Host '  App:        http://localhost:8000'
Write-Host ''
