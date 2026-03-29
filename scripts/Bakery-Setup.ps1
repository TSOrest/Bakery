#Requires -Version 5.1
<#
.SYNOPSIS
    Bakery — Інсталятор системи управління пекарнею

.DESCRIPTION
    Завантажує застосунок з GitHub, встановлює Python/Node.js якщо потрібно,
    ініціалізує базу даних, збирає фронтенд, реєструє автозапуск.

.PARAMETER InstallDir
    Папка встановлення. Якщо не вказано — відкривається вікно вибору папки.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1
    powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1 -InstallDir "C:\Пекарня"
#>
param(
    [string]$InstallDir  = '',
    [string]$DeployToken = ''   # Заповнюється через scripts\create-installer.ps1
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # прискорює Invoke-WebRequest

# ── Конфігурація ──────────────────────────────────────────────────────────────
$REPO_OWNER  = 'TSOrest'
$REPO_NAME   = 'Bakery'
$REPO_URL    = "https://github.com/$REPO_OWNER/$REPO_NAME.git"
$ARCHIVE_URL = "https://github.com/$REPO_OWNER/$REPO_NAME/archive/refs/heads/master.zip"
$APP_TASK    = 'BakeryApp'
$TRAY_TASK   = 'BakeryTray'
$MIN_PYTHON  = [Version]'3.11'
$MIN_NODE    = 18

# ── Допоміжні функції ─────────────────────────────────────────────────────────
function Write-Step { param($T) Write-Host "`n  ► $T" -ForegroundColor Cyan }
function Write-OK   { param($T) Write-Host "    ✓ $T" -ForegroundColor Green }
function Write-Warn { param($T) Write-Host "    ! $T" -ForegroundColor Yellow }
function Write-Info { param($T) Write-Host "    $T" -ForegroundColor DarkGray }

function Abort {
    param($T)
    Write-Host "`n  ✗ $T" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Натисніть Enter для виходу'
    exit 1
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

function Find-Python {
    foreach ($cmd in @('python', 'python3', 'py')) {
        try {
            $v = & $cmd --version 2>&1
            if ("$v" -match 'Python (\d+\.\d+)') {
                if ([Version]$Matches[1] -ge $MIN_PYTHON) {
                    $exe = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
                    if ($exe) { return $exe }
                }
            }
        } catch { }
    }
    return $null
}

function Find-Npm {
    $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
    try {
        $v = & node --version 2>&1
        if ("$v" -match 'v(\d+)' -and [int]$Matches[1] -ge $MIN_NODE) { return $npm }
    } catch { }
    return $null
}

# ── Банер ─────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════╗' -ForegroundColor DarkYellow
Write-Host '  ║    Пекарня — Встановлення системи        ║' -ForegroundColor DarkYellow
Write-Host '  ╚══════════════════════════════════════════╝' -ForegroundColor DarkYellow
Write-Host ''
Write-Host '  Цей майстер встановить систему управління пекарнею.' -ForegroundColor Gray
Write-Host '  Під час встановлення може автоматично завантажитися' -ForegroundColor Gray
Write-Host '  Python та Node.js якщо вони ще не встановлені.' -ForegroundColor Gray
Write-Host ''

# ── КРОК 1: Вибір папки ───────────────────────────────────────────────────────
Write-Step 'Вибір папки встановлення'

if (-not $InstallDir) {
    # GUI folder picker
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description         = 'Оберіть папку для встановлення Пекарня'
        $dlg.SelectedPath        = "$env:USERPROFILE\Bakery"
        $dlg.ShowNewFolderButton = $true
        $null = $dlg.ShowDialog()
        if ($dlg.SelectedPath) { $InstallDir = $dlg.SelectedPath }
    } catch { }
}

if (-not $InstallDir) {
    $default = "$env:USERPROFILE\Bakery"
    $ans = Read-Host "  Папка встановлення (Enter = $default)"
    $InstallDir = if ($ans) { $ans.Trim('"').Trim("'") } else { $default }
}

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
Write-OK "Папка: $InstallDir"

# Перевірка чи папка не порожня
if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -gt 0) {
    if (Test-Path "$InstallDir\.git") {
        Write-Warn 'Знайдено існуючу установку — оновлюємо.'
        $isUpdate = $true
    } else {
        $yn = Read-Host '  Папка вже містить файли. Видалити і встановити заново? (y/n)'
        if ($yn -ne 'y') { Abort 'Встановлення скасовано.' }
        $isUpdate = $false
    }
} else {
    $isUpdate = $false
}

# ── КРОК 2: Python 3.11+ ──────────────────────────────────────────────────────
Write-Step 'Перевірка Python 3.11+'

$pythonExe = Find-Python

if (-not $pythonExe) {
    Write-Warn "Python $MIN_PYTHON+ не знайдено. Встановлюємо автоматично..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info 'winget install Python.Python.3.12 ...'
        & winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements 2>&1 |
            Where-Object { $_ -match 'Successfully|Успішно|error|Error' } |
            ForEach-Object { Write-Info $_ }
    } else {
        $pyUrl  = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'
        $pyInst = "$env:TEMP\python-setup-$PID.exe"
        Write-Info 'Завантаження Python 3.12.7 (~25 MB)...'
        Invoke-WebRequest $pyUrl -OutFile $pyInst -UseBasicParsing
        Write-Info 'Встановлення Python...'
        $p = Start-Process $pyInst `
            -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1' `
            -Wait -PassThru
        Remove-Item $pyInst -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { Abort 'Помилка встановлення Python. Встановіть вручну: python.org' }
    }

    Refresh-Path
    $pythonExe = Find-Python

    if (-not $pythonExe) {
        Abort 'Python встановлено але не знайдено в PATH. Перезапустіть інсталятор.'
    }
}

$pyVer = (& $pythonExe --version 2>&1) -replace 'Python ', ''
Write-OK "Python $pyVer ($pythonExe)"

# ── КРОК 3: Node.js 18+ ───────────────────────────────────────────────────────
Write-Step 'Перевірка Node.js 18+'

$npmExe = Find-Npm

if (-not $npmExe) {
    Write-Warn "Node.js $MIN_NODE+ не знайдено. Встановлюємо автоматично..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info 'winget install OpenJS.NodeJS.LTS ...'
        & winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1 |
            Where-Object { $_ -match 'Successfully|Успішно|error|Error' } |
            ForEach-Object { Write-Info $_ }
    } else {
        $nodeUrl  = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
        $nodeInst = "$env:TEMP\node-setup-$PID.msi"
        Write-Info 'Завантаження Node.js 20.18 LTS (~30 MB)...'
        Invoke-WebRequest $nodeUrl -OutFile $nodeInst -UseBasicParsing
        Write-Info 'Встановлення Node.js...'
        $p = Start-Process msiexec -ArgumentList "/i `"$nodeInst`" /qn" -Wait -PassThru
        Remove-Item $nodeInst -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { Abort 'Помилка встановлення Node.js. Встановіть вручну: nodejs.org' }
    }

    Refresh-Path
    $npmExe = Find-Npm
    if (-not $npmExe) { Abort 'Node.js встановлено але npm не знайдено. Перезапустіть інсталятор.' }
}

$nodeVer = (& node --version 2>&1)
Write-OK "Node.js $nodeVer"

# ── КРОК 4: Завантаження коду з GitHub ────────────────────────────────────────
Write-Step 'Завантаження Пекарня з GitHub'

$gitExe  = (Get-Command git -ErrorAction SilentlyContinue).Source
$useGit  = $false

# Формуємо URL з токеном (якщо є)
$cloneUrl = if ($DeployToken) {
    "https://x-access-token:$DeployToken@github.com/$REPO_OWNER/$REPO_NAME.git"
} else { $REPO_URL }

$archiveUrl = if ($DeployToken) {
    "https://x-access-token:$DeployToken@github.com/$REPO_OWNER/$REPO_NAME/archive/refs/heads/master.zip"
} else { $ARCHIVE_URL }

if ($isUpdate -and $gitExe -and (Test-Path "$InstallDir\.git")) {
    # Оновлення існуючої установки
    Write-Info 'git pull...'
    $r = & $gitExe -C $InstallDir pull --rebase 2>&1
    if ($LASTEXITCODE -eq 0) {
        $useGit = $true
        Write-OK 'Код оновлено'
    } else {
        Write-Warn "git pull не вдався: $r"
        Write-Warn 'Перевстановлюємо...'
        $isUpdate = $false
    }
}

if (-not $useGit) {
    if ($gitExe) {
        Write-Info 'git clone --depth 1 ...'

        # Якщо папка не порожня — очищаємо
        if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -gt 0) {
            Remove-Item $InstallDir -Recurse -Force
        }

        $r = & $gitExe clone --depth 1 $cloneUrl $InstallDir 2>&1
        if ($LASTEXITCODE -eq 0) {
            # Прибираємо токен з remote URL
            & $gitExe -C $InstallDir remote set-url origin $REPO_URL 2>$null
            $useGit = $true
            Write-OK 'Код завантажено (git)'
        } else {
            Write-Warn "git clone не вдався — пробуємо ZIP..."
        }
    }

    if (-not $useGit) {
        $zipFile = "$env:TEMP\bakery-master-$PID.zip"
        $zipTemp = "$env:TEMP\bakery-zip-$PID"
        Write-Info 'Завантаження ZIP архіву...'
        Invoke-WebRequest $archiveUrl -OutFile $zipFile -UseBasicParsing

        Write-Info 'Розпакування...'
        Expand-Archive $zipFile -DestinationPath $zipTemp -Force
        $inner = (Get-ChildItem $zipTemp | Select-Object -First 1).FullName

        # Якщо папка не порожня — очищаємо
        if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item "$inner\*" -Destination $InstallDir -Recurse -Force

        Remove-Item $zipFile, $zipTemp -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK 'Код завантажено (ZIP)'
        Write-Warn 'Git не встановлено — функція автооновлення буде недоступна.'
    }
}

# ── КРОК 5: Python venv + залежності ─────────────────────────────────────────
Write-Step 'Встановлення Python залежностей'

$venvDir    = "$InstallDir\backend\venv"
$venvPython = "$venvDir\Scripts\python.exe"
$venvPip    = "$venvDir\Scripts\pip.exe"

if (-not (Test-Path $venvPython)) {
    Write-Info 'Створення virtual environment...'
    & $pythonExe -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { Abort 'Не вдалося створити venv.' }
}

Write-Info 'pip install (може тривати 1-2 хв)...'
& $venvPython -m pip install --upgrade pip -q --no-warn-script-location
& $venvPip install -r "$InstallDir\backend\requirements.txt" -q --no-warn-script-location
if ($LASTEXITCODE -ne 0) { Abort 'pip install завершився з помилкою.' }

Write-OK 'Python залежності встановлено'

# ── КРОК 6: Ініціалізація бази даних ─────────────────────────────────────────
Write-Step 'Ініціалізація бази даних'

# Запускаємо як окремий py-файл, щоб уникнути проблем з екрануванням
$dbScript = @"
import sqlite3, pathlib, sys

db_path  = pathlib.Path(r'__INSTALL_DIR__') / 'bakery.db'
root     = pathlib.Path(r'__INSTALL_DIR__')

if db_path.exists() and db_path.stat().st_size > 0:
    print('DB already exists — skipping schema, applying migrations only')
    skip_schema = True
else:
    skip_schema = False

db = sqlite3.connect(str(db_path))
db.execute('PRAGMA journal_mode=WAL')
db.execute('PRAGMA foreign_keys=ON')

def run_sql(sql):
    for stmt in sql.split(';'):
        stmt = stmt.strip()
        if stmt and not stmt.startswith('--'):
            try:
                db.execute(stmt)
            except Exception:
                pass
    db.commit()

if not skip_schema:
    schema = (root / 'database' / 'schema.sql').read_text('utf-8')
    run_sql(schema)
    print('Schema applied.')

mig_dir = root / 'database' / 'migrations'
if mig_dir.exists():
    for mig in sorted(mig_dir.glob('*.sql')):
        run_sql(mig.read_text('utf-8'))
        print(f'  Migration: {mig.name}')

db.close()
print('DB OK')
"@ -replace '__INSTALL_DIR__', $InstallDir.Replace('\', '\\')

$tmpScript = "$env:TEMP\bakery_db_init_$PID.py"
[IO.File]::WriteAllText($tmpScript, $dbScript, [Text.Encoding]::UTF8)

$r = & $venvPython $tmpScript 2>&1
Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue

Write-Info "$r"
if ("$r" -notmatch 'DB OK') { Abort "Помилка ініціалізації бази даних." }
Write-OK 'База даних готова'

# ── КРОК 7: Збірка фронтенду ──────────────────────────────────────────────────
Write-Step 'Збірка фронтенду'

Write-Info 'npm install...'
$p = Start-Process $npmExe -ArgumentList 'install' `
    -WorkingDirectory "$InstallDir\frontend" -Wait -PassThru -WindowStyle Hidden
if ($p.ExitCode -ne 0) { Abort 'npm install завершився з помилкою.' }

Write-Info 'npm run build...'
$p = Start-Process $npmExe -ArgumentList 'run build' `
    -WorkingDirectory "$InstallDir\frontend" -Wait -PassThru -WindowStyle Hidden
if ($p.ExitCode -ne 0) { Abort 'npm run build завершився з помилкою.' }

Write-OK 'Фронтенд зібрано'

# ── КРОК 8: Налаштування автозапуску ─────────────────────────────────────────
Write-Step 'Налаштування автозапуску (Task Scheduler)'

# Папка логів
$logsDir = "$InstallDir\logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# Генеруємо run-server.ps1 з правильними шляхами
$rootSlash   = $InstallDir.Replace("'", "''")
$pythonSlash = $venvPython.Replace("'", "''")
$serverScript = @"
# Bakery — server launcher (auto-generated by Bakery-Setup.ps1)
`$log    = '$rootSlash\logs\bakery.log'
`$python = '$pythonSlash'
taskkill /F /IM python.exe /T 2>`$null
Start-Sleep -Seconds 1
Add-Content `$log ("`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$rootSlash'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
"@
Set-Content -Path "$InstallDir\scripts\run-server.ps1" -Value $serverScript -Encoding UTF8

# Принципал — поточний користувач (Interactive, Limited)
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# ── BakeryApp ──────────────────────────────────────────────────────────────────
Unregister-ScheduledTask $APP_TASK -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask $APP_TASK `
    -Action   (New-ScheduledTaskAction `
                  -Execute 'powershell.exe' `
                  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\scripts\run-server.ps1`"" `
                  -WorkingDirectory $InstallDir) `
    -Trigger  (New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME) `
    -Settings (New-ScheduledTaskSettingsSet `
                  -ExecutionTimeLimit ([TimeSpan]::Zero) `
                  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
                  -StartWhenAvailable -MultipleInstances IgnoreNew) `
    -Principal $principal `
    -Description 'Bakery — сервер застосунку (автозапуск при вході)' `
    -Force | Out-Null
Write-OK "Завдання '$APP_TASK' зареєстровано"

# ── BakeryTray ─────────────────────────────────────────────────────────────────
Unregister-ScheduledTask $TRAY_TASK -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask $TRAY_TASK `
    -Action   (New-ScheduledTaskAction `
                  -Execute 'powershell.exe' `
                  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\scripts\run-tray.ps1`"" `
                  -WorkingDirectory $InstallDir) `
    -Trigger  (New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME) `
    -Settings (New-ScheduledTaskSettingsSet `
                  -ExecutionTimeLimit ([TimeSpan]::Zero) `
                  -StartWhenAvailable -MultipleInstances IgnoreNew) `
    -Principal $principal `
    -Description 'Bakery — іконка в системному треї (watchdog)' `
    -Force | Out-Null
Write-OK "Завдання '$TRAY_TASK' зареєстровано"

# ── КРОК 9: Запуск ────────────────────────────────────────────────────────────
Write-Step 'Запуск застосунку'

# Зупиняємо старі процеси
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Milliseconds 500
Start-ScheduledTask $APP_TASK
Write-Info 'Очікуємо запуску сервера...'

$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $status = (Invoke-WebRequest 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode
        if ($status -eq 200) { $ready = $true; break }
    } catch { }
    Write-Host "    [$i/30]..." -ForegroundColor DarkGray -NoNewline
    Write-Host "`r" -NoNewline
}

# Запускаємо трей
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
Start-ScheduledTask $TRAY_TASK -ErrorAction SilentlyContinue

# ── Фінальне повідомлення ────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║   ✓  Встановлення успішно завершено!         ║' -ForegroundColor Green
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  Застосунок:   ' -NoNewline
Write-Host 'http://localhost:8000' -ForegroundColor Cyan
Write-Host "  Папка:        $InstallDir" -ForegroundColor Gray
Write-Host "  Логи:         $InstallDir\logs\bakery.log" -ForegroundColor Gray
Write-Host '  Автозапуск:   Task Scheduler (при кожному вході в систему)' -ForegroundColor Gray
if ($useGit) {
    Write-Host '  Оновлення:    запустіть update.bat у папці застосунку' -ForegroundColor Gray
}
Write-Host ''

if ($ready) {
    Write-OK 'Сервер запущено — відкриваємо браузер...'
    Start-Sleep -Seconds 1
    Start-Process 'http://localhost:8000'
} else {
    Write-Warn 'Сервер стартує — відкрийте http://localhost:8000 за кілька секунд'
}

Write-Host ''
Read-Host '  Натисніть Enter для закриття'
