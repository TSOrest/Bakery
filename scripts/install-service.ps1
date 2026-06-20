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

# Logs та dev-файли — тільки в DATA_DIR, не в папці коду
# Видаляємо артефакти якщо вони потрапили в ROOT
Remove-Item -Path (Join-Path $ROOT 'logs') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $ROOT 'dev')  -Recurse -Force -ErrorAction SilentlyContinue

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
New-Item -ItemType Directory -Path "$DATA_DIR\logs"   -Force | Out-Null
$runnerPath = "$dataScriptsDir\run-server.ps1"

# Міграція bakery.db: якщо в ProgramData ще немає — копіюємо з папки коду
if (-not (Test-Path "$DATA_DIR\bakery.db") -and (Test-Path "$ROOT\bakery.db")) {
    Copy-Item "$ROOT\bakery.db" "$DATA_DIR\bakery.db" -Force
    foreach ($ext in @('-wal','-shm')) {
        if (Test-Path "$ROOT\bakery.db$ext") {
            Copy-Item "$ROOT\bakery.db$ext" "$DATA_DIR\bakery.db$ext" -Force
        }
    }
    Write-Host "DB migrated: $ROOT\bakery.db -> $DATA_DIR\bakery.db" -ForegroundColor Green
}

$rootEsc    = $ROOT.Replace("'", "''")
$pythonEsc  = $python.Replace("'", "''")
$dataDirEsc = $DATA_DIR.Replace("'", "''")
$runnerContent = @"
`$env:BAKERY_DATA_DIR = '$dataDirEsc'
`$logdir = '$dataDirEsc\logs'
`$python = '$pythonEsc'

# UTF-8 наскрізно (python emit + декодування native-виводу + запис без BOM) — щоб кирилиця в логах не ламалась.
`$env:PYTHONIOENCODING = 'utf-8'
`$env:PYTHONUTF8 = '1'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

New-Item -ItemType Directory -Path `$logdir -Force | Out-Null

# Лог по даті: один файл на добу (bakery-YYYY-MM-DD.log), повний datetime у кожному рядку.
function LogLine(`$msg) {
    `$f = Join-Path `$logdir ("bakery-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
    [System.IO.File]::AppendAllText(`$f, ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "]  " + `$msg + [Environment]::NewLine), [System.Text.UTF8Encoding]::new(`$false))
}

# Перевірка: якщо порт 8000 вже зайнятий — вбиваємо той процес
`$portBusy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (`$portBusy) {
    LogLine "ПОПЕРЕДЖЕННЯ: порт 8000 зайнятий (PID `$(`$portBusy.OwningProcess)), звільняємо..."
    Stop-Process -Id `$portBusy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

LogLine "Server starting..."
Set-Location '$rootEsc'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { LogLine `$_ }
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
    -RunLevel Highest   # потрібно для запису в C:\ProgramData\Bakery\

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
# Генеруємо run-tray.ps1 в DATA_DIR\scripts (як run-server.ps1) — не в git-папку,
# щоб git pull при оновленні не перезаписував згенерований файл.
$trayRunner = "$dataScriptsDir\run-tray.ps1"
$rootEscTray = $ROOT.Replace("'", "''")
$trayRunnerContent = @"
# run-tray.ps1 — watchdog for tray.py (generated by install-service.ps1)
`$env:BAKERY_DATA_DIR = '$dataDirEsc'
`$ROOT       = '$rootEscTray'
`$pythonw    = Join-Path `$ROOT 'backend\venv\Scripts\pythonw.exe'
`$trayScript = Join-Path `$ROOT 'tray.py'

while (`$true) {
    if (Test-Path `$pythonw) {
        & `$pythonw `$trayScript
    }
    Start-Sleep -Seconds 5
}
"@
Set-Content -Path $trayRunner -Value $trayRunnerContent -Encoding UTF8
Write-Host "run-tray.ps1 generated: $trayRunner" -ForegroundColor Green

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

