#Requires -Version 5.1
<#
.SYNOPSIS
    Bakery — Інсталятор системи управління пекарнею

.DESCRIPTION
    Авторизується в GitHub під обліковим записом клієнта (Device Flow OAuth),
    завантажує застосунок з приватного репозиторію, встановлює Python/Node.js
    якщо потрібно, ініціалізує базу даних, збирає фронтенд, реєструє автозапуск.

.PARAMETER InstallDir
    Папка встановлення. Якщо не вказано — відкривається вікно вибору папки.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1
    powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1 -InstallDir "C:\Пекарня"
#>
param(
    [string]$InstallDir = ''
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# UTF-8 у консолі — без цього PS 5.1 показує ? замість українських літер і/ї/є/ґ
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding          = [Text.UTF8Encoding]::new($false)

# TLS 1.2 — на старих Windows 10 / .NET 4.5 може бути TLS 1.0 за замовчуванням,
# GitHub API вимагає TLS 1.2+
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Безпечна TEMP-папка без кирилиці у шляху.
# $env:TEMP = C:\Users\Админ\... — .NET крипто-операції та ZipFile падають на не-ASCII шляхах.
# C:\Windows\Temp — завжди ASCII, завжди існує, доступна всім процесам під час інсталяції.
$SAFE_TEMP = 'C:\Windows\Temp'

# Лог-файл інсталятора — завжди пишемо сюди, незалежно від результату
$INSTALL_LOG = "$SAFE_TEMP\bakery-install.log"
function Write-Log { param($T) $T | Out-File $INSTALL_LOG -Encoding UTF8 -Append }
Write-Log "=== Bakery installer started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# Перехоплювач необроблених помилок — вікно не закриється, лог залишиться
trap {
    $errMsg = "FATAL: $_`n$($_.ScriptStackTrace)"
    Write-Host "`n  ====================================================" -ForegroundColor Red
    Write-Host "  ПОМИЛКА ВСТАНОВЛЕННЯ:" -ForegroundColor Red
    Write-Host "    $_" -ForegroundColor Red
    Write-Host "  ====================================================" -ForegroundColor Red
    Write-Host "  Лог збережено: $INSTALL_LOG" -ForegroundColor Yellow
    Write-Log $errMsg
    Read-Host "`n  Натисніть Enter для виходу"
    exit 1
}

# ── Конфігурація (заповнюється через create-installer.ps1) ────────────────────
$GITHUB_CLIENT_ID = 'Ov23livInSt2afY13irB'  # OAuth App client_id (публічний, не секрет)
$REPO_OWNER       = 'TSOrest'
$REPO_NAME        = 'Bakery'
$REPO_URL         = "https://github.com/$REPO_OWNER/$REPO_NAME.git"
$APP_TASK         = 'BakeryApp'
$TRAY_TASK        = 'BakeryTray'
$MIN_PYTHON       = [Version]'3.11'
$MIN_NODE         = 18
$INSTALL_DIR      = 'C:\Program Files\Bakery'   # код застосунку (фіксований)
$DATA_DIR         = 'C:\ProgramData\Bakery'     # дані: БД, логи, скрипти з шляхами
$REG_PATH         = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bakery'

# ── Допоміжні функції ─────────────────────────────────────────────────────────
function Write-Step { param($T) Write-Host "`n  ► $T" -ForegroundColor Cyan;   Write-Log "STEP: $T" }
function Write-OK   { param($T) Write-Host "    ✓ $T" -ForegroundColor Green;  Write-Log "OK:   $T" }
function Write-Warn { param($T) Write-Host "    ! $T" -ForegroundColor Yellow; Write-Log "WARN: $T" }
function Write-Info { param($T) Write-Host "    $T"   -ForegroundColor DarkGray }

function Abort {
    param($T)
    Write-Host "`n  ✗ $T" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Натисніть Enter для виходу'
    exit 1
}

# Запускає нативну команду, захоплює stdout+stderr, не кидає NativeCommandError.
# У PS 5.1 пайп native 2>&1 | ... кидає термінальну помилку якщо exit!=0.
function Invoke-Native {
    param([string]$Exe, [string[]]$CmdArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & $Exe @CmdArgs 2>&1 | ForEach-Object { "$_" }
    $ErrorActionPreference = $prev
    return $out
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

function Find-ExistingInstall {
    # Тільки реєстр Windows — він заповнюється виключно повним інсталятором.
    # Task Scheduler НЕ використовується як fallback: install-service.bat теж реєструє
    # задачу BakeryApp, тому на машині розробника це давало б хибне спрацювання.
    try {
        $reg = Get-ItemProperty -Path $REG_PATH -ErrorAction SilentlyContinue
        if ($reg -and $reg.InstallLocation -and (Test-Path "$($reg.InstallLocation)\backend")) {
            return $reg.InstallLocation
        }
    } catch {}
    return $null
}

function Invoke-Uninstall {
    param([string]$Dir)

    Write-Step 'Зупинка служб'

    # Зупиняємо процеси
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*') -or
                       ($_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500

    # Зупиняємо і видаляємо завдання планувальника
    Stop-ScheduledTask  $APP_TASK  -ErrorAction SilentlyContinue
    Stop-ScheduledTask  $TRAY_TASK -ErrorAction SilentlyContinue
    Unregister-ScheduledTask $APP_TASK  -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask $TRAY_TASK -Confirm:$false -ErrorAction SilentlyContinue
    Write-OK 'Завдання планувальника видалено'

    # Пропонуємо зберегти базу даних
    $dbFile = "$Dir\bakery.db"
    if (Test-Path $dbFile) {
        Write-Host ''
        $ans = Read-Host '  Зберегти базу даних на робочий стіл? (y/n)'
        if ($ans -eq 'y') {
            $stamp    = Get-Date -Format 'yyyyMMdd_HHmmss'
            $destFile = "$env:USERPROFILE\Desktop\bakery_backup_$stamp.db"
            Copy-Item $dbFile $destFile -Force
            Write-OK "Базу збережено: $destFile"
        }
    }

    # Видаляємо папку
    Write-Host ''
    $ans2 = Read-Host "  Видалити папку '$Dir'? (y/n)"
    if ($ans2 -eq 'y') {
        Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $Dir)) {
            Write-OK "Папку видалено: $Dir"
        } else {
            Write-Warn 'Деякі файли не вдалося видалити (можливо відкриті). Видаліть папку вручну.'
        }
    } else {
        Write-Info "Папку збережено: $Dir"
    }

    # Видаляємо запис з реєстру (Програми та компоненти)
    Remove-Item -Path $REG_PATH -Force -ErrorAction SilentlyContinue
    Write-OK 'Запис у реєстрі видалено'

    # Видаляємо ярлики
    Remove-Item "$env:USERPROFILE\Desktop\Пекарня.url"    -Force -ErrorAction SilentlyContinue
    Remove-Item "$env:USERPROFILE\Desktop\Пекарня.lnk"    -Force -ErrorAction SilentlyContinue
    $startDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Пекарня"
    if (Test-Path $startDir) {
        Remove-Item $startDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK 'Ярлики видалено'
    }

    # Видаляємо правило брандмауера
    netsh advfirewall firewall delete rule name="BakeryApp" 2>$null | Out-Null

    # Видаляємо папку ProgramData\Bakery\scripts (якщо є)
    $dataScripts = "$DATA_DIR\scripts"
    if (Test-Path $dataScripts) {
        Remove-Item $dataScripts -Recurse -Force -ErrorAction SilentlyContinue
    }
    # Видаляємо DATA_DIR якщо порожній
    if ((Test-Path $DATA_DIR) -and -not (Get-ChildItem $DATA_DIR -ErrorAction SilentlyContinue)) {
        Remove-Item $DATA_DIR -Force -ErrorAction SilentlyContinue
    }

    # Чистимо git credentials
    $credFile = "$env:USERPROFILE\.git-credentials"
    if (Test-Path $credFile) {
        try {
            $lines = Get-Content $credFile | Where-Object { $_ -notmatch 'github\.com' }
            Set-Content $credFile $lines -Encoding UTF8 -ErrorAction SilentlyContinue
        } catch {}
    }

    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
    Write-Host '  ║   ✓  Програму успішно видалено!              ║' -ForegroundColor Green
    Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
    Write-Host ''
    Read-Host '  Натисніть Enter для закриття'
    exit 0
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
    # Шукаємо npm.cmd явно — Get-Command може повернути npm.ps1, який Windows
    # відкриває в Блокноті замість виконання
    $npm = $null
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if ($npmCmd) {
        $npm = $npmCmd
    } else {
        $src = (Get-Command npm -ErrorAction SilentlyContinue).Source
        if ($src -and $src -notmatch '\.ps1$') { $npm = $src }
    }
    if (-not $npm) { return $null }
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
Write-Host '  Для встановлення потрібен GitHub-акаунт із доступом до репозиторію.' -ForegroundColor Gray
Write-Host '  Якщо ще немає — зверніться до розробника для отримання доступу.' -ForegroundColor Gray
Write-Host ''

# ── Виявлення існуючої установки ──────────────────────────────────────────────
$existingDir = Find-ExistingInstall
$isReinstall = $false

if ($existingDir) {
    Write-Host '  Знайдено встановлену програму:' -ForegroundColor Gray
    Write-Host "    $existingDir" -ForegroundColor White
    Write-Host ''
    Write-Host '    [1]  Перевстановити  (файли оновляться, база даних збережеться)' -ForegroundColor White
    Write-Host '    [2]  Видалити програму' -ForegroundColor White
    Write-Host '    [3]  Скасувати' -ForegroundColor DarkGray
    Write-Host ''
    $choice = Read-Host '  Ваш вибір (1-3)'

    switch ($choice) {
        '1' {
            $InstallDir  = $existingDir
            $isReinstall = $true
            Write-OK "Перевстановлення: $InstallDir"
        }
        '2' { Invoke-Uninstall -Dir $existingDir }
        default { Abort 'Встановлення скасовано.' }
    }
}

# ── КРОК 1: Папка встановлення (фіксована) ───────────────────────────────────
Write-Step 'Папка встановлення'

if (-not $isReinstall) {
    $InstallDir = $INSTALL_DIR
}

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
Write-OK "Папка: $InstallDir"

$isUpdate = $false
if ($isReinstall) {
    if (Test-Path "$InstallDir\.git") { $isUpdate = $true }
    Write-Warn 'База даних збережеться'
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -gt 0) {
    if (Test-Path "$InstallDir\.git") {
        Write-Warn 'Знайдено існуючу установку — оновлюємо.'
        $isUpdate = $true
    } else {
        $yn = Read-Host '  Папка вже містить файли. Видалити і встановити заново? (y/n)'
        if ($yn -ne 'y') { Abort 'Встановлення скасовано.' }
    }
}

# ── КРОК 2: GitHub авторизація (Device Flow) ──────────────────────────────────
Write-Step 'Авторизація в GitHub'

if (-not $GITHUB_CLIENT_ID) {
    Abort 'OAuth Client ID не налаштовано. Зверніться до розробника.'
}

# Запит device code
try {
    $deviceResp = Invoke-RestMethod `
        -Uri    'https://github.com/login/device/code' `
        -Method Post `
        -Body   "client_id=$GITHUB_CLIENT_ID&scope=repo" `
        -ContentType 'application/x-www-form-urlencoded' `
        -Headers @{ Accept = 'application/json' }
} catch {
    Abort "Не вдалося з'єднатися з GitHub. Перевірте інтернет-з'єднання."
}

$deviceCode = $deviceResp.device_code
$userCode   = $deviceResp.user_code
$pollSec    = if ($deviceResp.interval) { [int]$deviceResp.interval } else { 5 }
$expiresAt  = [datetime]::Now.AddSeconds($(if ($deviceResp.expires_in) { [int]$deviceResp.expires_in } else { 900 }))

Write-Host ''
Write-Host '  ┌─────────────────────────────────────────────────┐' -ForegroundColor Yellow
Write-Host '  │  1. Відкрийте у браузері:                       │' -ForegroundColor Yellow
Write-Host '  │     https://github.com/login/device            │' -ForegroundColor Yellow
Write-Host '  │                                                 │' -ForegroundColor Yellow
Write-Host "  │  2. Введіть код:  " -ForegroundColor Yellow -NoNewline
Write-Host "$userCode" -ForegroundColor White -NoNewline
Write-Host '               │' -ForegroundColor Yellow
Write-Host '  │                                                 │' -ForegroundColor Yellow
Write-Host '  │  3. Увійдіть своїм GitHub-акаунтом та підтвердьте│' -ForegroundColor Yellow
Write-Host '  └─────────────────────────────────────────────────┘' -ForegroundColor Yellow
Write-Host ''

# Відкриваємо браузер автоматично
Start-Process 'https://github.com/login/device' -ErrorAction SilentlyContinue

# Поллінг
$accessToken  = $null
$githubLogin  = $null
Write-Info 'Очікуємо підтвердження авторизації...'

while ([datetime]::Now -lt $expiresAt) {
    Start-Sleep -Seconds $pollSec
    try {
        $tokenResp = Invoke-RestMethod `
            -Uri    'https://github.com/login/oauth/access_token' `
            -Method Post `
            -Body   "client_id=$GITHUB_CLIENT_ID&device_code=$deviceCode&grant_type=urn:ietf:params:oauth:grant-type:device_code" `
            -ContentType 'application/x-www-form-urlencoded' `
            -Headers @{ Accept = 'application/json' } `
            -ErrorAction SilentlyContinue

        switch ($tokenResp.error) {
            'authorization_pending' { Write-Host '    .' -NoNewline -ForegroundColor DarkGray }
            'slow_down'             { $pollSec += 5 }
            'access_denied'         { Abort 'Авторизацію скасовано. Встановлення перервано.' }
            'expired_token'         { Abort 'Час очікування минув. Запустіть інсталятор ще раз.' }
            ''                      {
                if ($tokenResp.access_token) {
                    $accessToken = $tokenResp.access_token
                }
            }
        }

        if ($accessToken) { break }
    } catch { }
}
Write-Host ''

if (-not $accessToken) { Abort 'Не вдалося отримати токен авторизації.' }

# Отримуємо логін користувача
try {
    $me = Invoke-RestMethod `
        -Uri     'https://api.github.com/user' `
        -Headers @{ Authorization = "Bearer $accessToken"; 'User-Agent' = 'BakeryApp-Installer/1.0' }
    $githubLogin = $me.login
} catch {
    Abort 'Не вдалося отримати дані облікового запису GitHub.'
}

Write-OK "Авторизовано як: $githubLogin"

# Перевіряємо доступ до репозиторію
try {
    $null = Invoke-RestMethod `
        -Uri     "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME" `
        -Headers @{ Authorization = "Bearer $accessToken"; 'User-Agent' = 'BakeryApp-Installer/1.0' }
} catch {
    Abort "Обліковий запис '$githubLogin' не має доступу до репозиторію. Зверніться до розробника."
}

# ── КРОК 3: Python 3.11+ ──────────────────────────────────────────────────────
Write-Step 'Перевірка Python 3.11+'

$pythonExe = Find-Python

if (-not $pythonExe) {
    Write-Warn "Python $MIN_PYTHON+ не знайдено. Встановлюємо автоматично..."

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info 'winget install Python.Python.3.12 ...'
        $out = Invoke-Native winget @('install','Python.Python.3.12','--silent','--accept-package-agreements','--accept-source-agreements')
        $out | Where-Object { $_ -match 'Successfully|error' } | ForEach-Object { Write-Info $_ }
    } else {
        $pyUrl  = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'
        $pyInst = "$SAFE_TEMP\python-setup-$PID.exe"
        Write-Info 'Завантаження Python 3.12.7 (~25 MB)...'
        Invoke-WebRequest $pyUrl -OutFile $pyInst -UseBasicParsing
        $p = Start-Process $pyInst '/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1' -Wait -PassThru
        Remove-Item $pyInst -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { Abort 'Помилка встановлення Python. Встановіть вручну: python.org' }
    }

    Refresh-Path
    $pythonExe = Find-Python
    if (-not $pythonExe) { Abort 'Python встановлено але не знайдено в PATH. Перезапустіть інсталятор.' }
}

Write-OK "Python $((Invoke-Native $pythonExe @('--version')) -replace 'Python ','')"

# ── КРОК 4: Node.js 18+ ───────────────────────────────────────────────────────
Write-Step 'Перевірка Node.js 18+'

$npmExe = Find-Npm

if (-not $npmExe) {
    Write-Warn "Node.js $MIN_NODE+ не знайдено. Встановлюємо автоматично..."

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info 'winget install OpenJS.NodeJS.LTS ...'
        $out = Invoke-Native winget @('install','OpenJS.NodeJS.LTS','--silent','--accept-package-agreements','--accept-source-agreements')
        $out | Where-Object { $_ -match 'Successfully|error' } | ForEach-Object { Write-Info $_ }
    } else {
        $nodeUrl  = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
        $nodeInst = "$SAFE_TEMP\node-setup-$PID.msi"
        Write-Info 'Завантаження Node.js 20.18 LTS (~30 MB)...'
        Invoke-WebRequest $nodeUrl -OutFile $nodeInst -UseBasicParsing
        $p = Start-Process msiexec "/i `"$nodeInst`" /qn" -Wait -PassThru
        Remove-Item $nodeInst -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { Abort 'Помилка встановлення Node.js. Встановіть вручну: nodejs.org' }
    }

    Refresh-Path
    $npmExe = Find-Npm
    if (-not $npmExe) { Abort 'Node.js встановлено але npm не знайдено. Перезапустіть інсталятор.' }
}

Write-OK "Node.js $((Invoke-Native node @('--version')))"

# ── КРОК 5: Завантаження коду з GitHub ────────────────────────────────────────
Write-Step 'Завантаження Пекарня з GitHub'

# При перевстановленні зберігаємо копію БД — на випадок якщо git clone видалить папку
# Порядок: DATA_DIR (нова папка даних) → InstallDir (legacy) → нічого
$dbBackupPath = $null
if ($isReinstall) {
    if (Test-Path "$DATA_DIR\bakery.db") {
        $dbBackupPath = "$SAFE_TEMP\bakery_reinstall_$PID.db"
        Copy-Item "$DATA_DIR\bakery.db" $dbBackupPath -Force
        Write-Info 'База даних збережена для відновлення (з ProgramData)'
    } elseif (Test-Path "$InstallDir\bakery.db") {
        $dbBackupPath = "$SAFE_TEMP\bakery_reinstall_$PID.db"
        Copy-Item "$InstallDir\bakery.db" $dbBackupPath -Force
        Write-Info 'База даних збережена для відновлення (з папки коду)'
    }
}

$cloneUrl = "https://x-access-token:$accessToken@github.com/$REPO_OWNER/$REPO_NAME.git"
$gitExe   = (Get-Command git -ErrorAction SilentlyContinue).Source
$useGit   = $false

# Встановлюємо git якщо не знайдено
if (-not $gitExe) {
    Write-Warn 'Git не знайдено. Встановлюємо автоматично...'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info 'winget install Git.Git ...'
        $out = Invoke-Native winget @('install','Git.Git','--silent','--accept-package-agreements','--accept-source-agreements')
        $out | Where-Object { $_ -match 'Successfully|error' } | ForEach-Object { Write-Info $_ }
    } else {
        $gitUrl  = 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe'
        $gitInst = "$SAFE_TEMP\git-setup-$PID.exe"
        Write-Info 'Завантаження Git (~60 MB)...'
        Invoke-WebRequest $gitUrl -OutFile $gitInst -UseBasicParsing
        $p = Start-Process $gitInst '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"' -Wait -PassThru
        Remove-Item $gitInst -Force -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { Write-Warn 'Помилка встановлення Git. Продовжуємо без нього (оновлення через ZIP).' }
    }
    Refresh-Path
    $gitExe = (Get-Command git -ErrorAction SilentlyContinue).Source
    if ($gitExe) { Write-OK "Git встановлено: $gitExe" }
    else { Write-Warn 'Git не вдалося знайти після встановлення. Продовжуємо без нього.' }
}

# Зберігаємо git credentials для майбутніх оновлень
if ($gitExe) {
    $credFile = "$env:USERPROFILE\.git-credentials"
    $credLine = "https://x-access-token:$accessToken@github.com"
    # Видаляємо старий запис для github.com якщо є
    if (Test-Path $credFile) {
        $lines = Get-Content $credFile | Where-Object { $_ -notmatch 'github\.com' }
        Set-Content $credFile ($lines + $credLine) -Encoding UTF8
    } else {
        Set-Content $credFile $credLine -Encoding UTF8
    }
    & $gitExe config --global credential.helper store 2>$null
}

if ($isUpdate -and $gitExe -and (Test-Path "$InstallDir\.git")) {
    Write-Info 'git pull --rebase ...'
    $gitOut = Invoke-Native $gitExe @('-C',$InstallDir,'pull','--rebase')
    $gitOut | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -eq 0) {
        $useGit = $true
        Write-OK 'Код оновлено'
    } else {
        Write-Warn 'git pull не вдався — перевстановлюємо...'
        $isUpdate = $false
    }
}

if (-not $useGit) {
    if ($gitExe) {
        Write-Info 'git clone --depth 1 ...'
        if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
        $gitOut = Invoke-Native $gitExe @('clone','--depth','1',$cloneUrl,$InstallDir)
        $gitOut | ForEach-Object { Write-Info $_ }
        if ($LASTEXITCODE -eq 0) {
            # Прибираємо токен з remote (credential helper вже налаштований)
            & $gitExe -C $InstallDir remote set-url origin $REPO_URL 2>$null
            $useGit = $true
            Write-OK 'Код завантажено (git)'
        } else {
            Write-Warn 'git clone не вдався — пробуємо ZIP...'
        }
    }

    if (-not $useGit) {
        $zipUrl  = "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/zipball/master"
        $zipFile = "$SAFE_TEMP\bakery-master-$PID.zip"
        $zipTemp = "$SAFE_TEMP\bakery-zip-$PID"
        Write-Info 'Завантаження ZIP архіву...'
        Invoke-WebRequest $zipUrl -OutFile $zipFile -UseBasicParsing `
            -Headers @{ Authorization = "Bearer $accessToken"; 'User-Agent' = 'BakeryApp-Installer/1.0' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFile, $zipTemp)
        $inner = (Get-ChildItem $zipTemp | Select-Object -First 1).FullName
        if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item "$inner\*" -Destination $InstallDir -Recurse -Force
        Remove-Item $zipFile, $zipTemp -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK 'Код завантажено (ZIP)'
        Write-Warn 'Git не встановлено — автооновлення недоступне.'
    }
}

# Відновлюємо БД в DATA_DIR (нова папка даних — відокремлена від коду)
New-Item -ItemType Directory -Path $DATA_DIR -Force | Out-Null
if ($dbBackupPath -and (Test-Path $dbBackupPath)) {
    Copy-Item $dbBackupPath "$DATA_DIR\bakery.db" -Force
    Remove-Item $dbBackupPath -Force -ErrorAction SilentlyContinue
    Write-Info 'Базу даних відновлено → C:\ProgramData\Bakery\bakery.db'
} elseif (-not $isReinstall -and (Test-Path "$InstallDir\bakery.db")) {
    # Перший запуск після оновлення з legacy — міграція існуючої БД
    Copy-Item "$InstallDir\bakery.db" "$DATA_DIR\bakery.db" -Force
    Write-Info 'Базу даних перенесено з папки коду → C:\ProgramData\Bakery\bakery.db'
}

# ── КРОК 6: Python venv + залежності ─────────────────────────────────────────
Write-Step 'Встановлення Python залежностей'

$venvDir    = "$InstallDir\backend\venv"
$venvPython = "$venvDir\Scripts\python.exe"
$venvPip    = "$venvDir\Scripts\pip.exe"

if (-not (Test-Path $venvPython)) {
    Write-Info 'Створення virtual environment...'
    Invoke-Native $pythonExe @('-m','venv',$venvDir) | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) { Abort 'Не вдалося створити venv.' }
}

Write-Info 'pip install (може тривати 1-2 хв)...'
Invoke-Native $venvPython @('-m','pip','install','--upgrade','pip','-q','--no-warn-script-location') | Out-Null
Invoke-Native $venvPip @('install','-r',"$InstallDir\backend\requirements.txt",'-q','--no-warn-script-location') | Out-Null
if ($LASTEXITCODE -ne 0) { Abort 'pip install завершився з помилкою.' }

Write-OK 'Python залежності встановлено'

# ── КРОК 7: Ініціалізація бази даних + збереження токену ──────────────────────
Write-Step 'Ініціалізація бази даних'

$escapedDir     = $InstallDir.Replace('\', '\\')
$escapedDataDir = $DATA_DIR.Replace('\', '\\')
$escapedToken   = $accessToken.Replace("'", "\\'")
$escapedLogin   = $githubLogin.Replace("'", "\\'")
$isReinstallPy  = if ($isReinstall) { 'True' } else { 'False' }

$dbScript = @"
import sqlite3, pathlib

IS_REINSTALL = $isReinstallPy
root     = pathlib.Path(r'$escapedDir')
data_dir = pathlib.Path(r'$escapedDataDir')
data_dir.mkdir(parents=True, exist_ok=True)
db_path  = data_dir / 'bakery.db'

import sys, os
os.environ['BAKERY_DATA_DIR'] = str(data_dir)
os.chdir(str(root))
sys.path.insert(0, str(root))

if not IS_REINSTALL:
    # Fresh install — видаляємо будь-який залишковий файл БД
    for suffix in ('', '-wal', '-shm'):
        p = pathlib.Path(str(db_path) + suffix)
        if p.exists():
            p.unlink()

# create_all: при fresh install — створює всі таблиці;
#             при reinstall — додає нові таблиці якщо з'явились (IF NOT EXISTS семантика)
from backend.database import engine, Base
import backend.models.references
import backend.models.orders
import backend.models.pricing
import backend.models.baking
import backend.models.invoices
import backend.models.movements
import backend.models.finances
import backend.models.shop
import backend.models.settings
import backend.models.auth
Base.metadata.create_all(engine)
print('Tables created.' if not IS_REINSTALL else 'Tables verified.')

db = sqlite3.connect(str(db_path))
db.execute('PRAGMA journal_mode=WAL')
db.execute('PRAGMA foreign_keys=ON')

if not IS_REINSTALL:
    # Seed: дефолтні налаштування, одиниці виміру, категорії
    schema_sql = (root / 'database' / 'schema.sql').read_text('utf-8')
    for stmt in schema_sql.split(';'):
        lines = [l for l in stmt.splitlines() if not l.strip().startswith('--')]
        stmt = '\n'.join(lines).strip()
        if stmt.upper().startswith('INSERT'):
            try:
                db.execute(stmt)
            except Exception:
                pass
    db.commit()

# Міграції — безпечні для обох сценаріїв (IF NOT EXISTS / ALTER IGNORE)
mig_dir = root / 'database' / 'migrations'
if mig_dir.exists():
    for f in sorted(mig_dir.glob('*.sql')):
        for stmt in f.read_text('utf-8').split(';'):
            lines = [l for l in stmt.splitlines() if not l.strip().startswith('--')]
            stmt = '\n'.join(lines).strip()
            if stmt:
                try:
                    db.execute(stmt)
                except Exception:
                    pass
        db.commit()

print('Schema applied.')

# Зберігаємо GitHub-токен та логін
def upsert(key, value, desc):
    row = db.execute('SELECT key FROM settings WHERE key=?', (key,)).fetchone()
    if row:
        db.execute('UPDATE settings SET value=? WHERE key=?', (value, key))
    else:
        db.execute('INSERT INTO settings (key,value,description) VALUES (?,?,?)', (key, value, desc))
    db.commit()

upsert('github_oauth_token', r'$escapedToken', 'GitHub OAuth token (авторизований обліковий запис клієнта)')
upsert('github_login',       '$escapedLogin', 'GitHub логін клієнта')
upsert('github_repo',        '$REPO_OWNER/$REPO_NAME', 'GitHub репозиторій (owner/repo)')
print('GitHub credentials saved.')

db.close()
print('DB OK')
"@

$tmpScript = "$SAFE_TEMP\bakery_db_init_$PID.py"
[IO.File]::WriteAllText($tmpScript, $dbScript, [Text.Encoding]::UTF8)
$r = Invoke-Native $venvPython @($tmpScript)
Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue

$rText = $r -join "`n"
Write-Info $rText
if ($rText -notmatch 'DB OK') {
    Write-Host "    Вивід Python:" -ForegroundColor Red
    $r | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
    Abort 'Помилка ініціалізації бази даних.'
}
Write-OK 'База даних готова'

# ── КРОК 8: Збірка фронтенду ──────────────────────────────────────────────────
Write-Step 'Збірка фронтенду'

Write-Info 'npm install...'
$p = Start-Process $npmExe 'install' -WorkingDirectory "$InstallDir\frontend" -Wait -PassThru -WindowStyle Hidden
if ($p.ExitCode -ne 0) { Abort 'npm install завершився з помилкою.' }

Write-Info 'npm run build...'
$p = Start-Process $npmExe 'run build' -WorkingDirectory "$InstallDir\frontend" -Wait -PassThru -WindowStyle Hidden
if ($p.ExitCode -ne 0) { Abort 'npm run build завершився з помилкою.' }

Write-OK 'Фронтенд зібрано'

# ── КРОК 9: Налаштування автозапуску ─────────────────────────────────────────
Write-Step 'Налаштування автозапуску (Task Scheduler)'

# Генеруємо run-server.ps1 в ProgramData (не в папці коду — переживає перевстановлення)
$dataScriptsDir = "$DATA_DIR\scripts"
New-Item -ItemType Directory -Path $dataScriptsDir -Force | Out-Null
New-Item -ItemType Directory -Path "$DATA_DIR\logs"   -Force | Out-Null

$rootQ      = $InstallDir.Replace("'", "''")
$pythonQ    = $venvPython.Replace("'", "''")
$dataDirQ   = $DATA_DIR.Replace("'", "''")
$runServerPath = "$dataScriptsDir\run-server.ps1"

$serverScript = @"
# Bakery server launcher — auto-generated by Bakery-Setup.ps1
`$env:BAKERY_DATA_DIR = '$dataDirQ'
`$log    = '$dataDirQ\logs\bakery.log'
`$python = '$pythonQ'

# Перевірка: якщо порт 8000 вже зайнятий — вбиваємо той процес
`$portBusy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (`$portBusy) {
    Add-Content `$log ("`n[" + (Get-Date -Format 'HH:mm:ss') + "]  ПОПЕРЕДЖЕННЯ: порт 8000 зайнятий (PID `$(`$portBusy.OwningProcess)), звільняємо...")
    Stop-Process -Id `$portBusy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Add-Content `$log ("`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$rootQ'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
"@
Set-Content $runServerPath $serverScript -Encoding UTF8
Write-OK "run-server.ps1 → $runServerPath"

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Unregister-ScheduledTask $APP_TASK -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask $APP_TASK `
    -Action   (New-ScheduledTaskAction `
                  -Execute 'powershell.exe' `
                  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runServerPath`"" `
                  -WorkingDirectory $InstallDir) `
    -Trigger  (New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME) `
    -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
                  -StartWhenAvailable -MultipleInstances IgnoreNew) `
    -Principal $principal -Description 'Bakery — сервер застосунку' -Force | Out-Null
Write-OK "Завдання '$APP_TASK' зареєстровано"

Unregister-ScheduledTask $TRAY_TASK -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask $TRAY_TASK `
    -Action   (New-ScheduledTaskAction `
                  -Execute 'powershell.exe' `
                  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\scripts\run-tray.ps1`"" `
                  -WorkingDirectory $InstallDir) `
    -Trigger  (New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME) `
    -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                  -StartWhenAvailable -MultipleInstances IgnoreNew) `
    -Principal $principal -Description 'Bakery — іконка в треї' -Force | Out-Null
Write-OK "Завдання '$TRAY_TASK' зареєстровано"

# ── Правило брандмауера ────────────────────────────────────────────────────────
# Правило для порту (доступ з мережі) — profile=any щоб діяло і на публічних мережах
$fwExists = netsh advfirewall firewall show rule name="BakeryApp" 2>$null
if ($fwExists -notmatch 'Rule Name') {
    netsh advfirewall firewall add rule `
        name="BakeryApp" dir=in action=allow protocol=TCP localport=8000 `
        profile=any 2>$null | Out-Null
}
# Правило для програми Python — щоб Windows не блокував і не показував діалог
# при запуску через Task Scheduler (де діалог не може з'явитись)
$pythonFwExists = netsh advfirewall firewall show rule name="BakeryApp-Python" 2>$null
if ($pythonFwExists -notmatch 'Rule Name') {
    netsh advfirewall firewall add rule `
        name="BakeryApp-Python" dir=in action=allow program="$venvPython" `
        profile=any 2>$null | Out-Null
    netsh advfirewall firewall add rule `
        name="BakeryApp-Pythonw" dir=in action=allow program="$($venvPython -replace 'python\.exe$','pythonw.exe')" `
        profile=any 2>$null | Out-Null
}
Write-OK 'Правило брандмауера: Python дозволено (порт 8000)'

# ── Реєстрація в «Програми та компоненти» ─────────────────────────────────────
$version = if (Test-Path "$InstallDir\VERSION") { (Get-Content "$InstallDir\VERSION" -Encoding UTF8).Trim().TrimStart([char]0xFEFF) } else { '1.0' }
New-Item -Path $REG_PATH -Force | Out-Null
Set-ItemProperty $REG_PATH 'DisplayName'     'Пекарня'
Set-ItemProperty $REG_PATH 'DisplayVersion'  $version
Set-ItemProperty $REG_PATH 'Publisher'       'TSOrest'
Set-ItemProperty $REG_PATH 'InstallLocation' $InstallDir
Set-ItemProperty $REG_PATH 'UninstallString' "powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\Bakery-Setup.ps1`" -Uninstall"
Set-ItemProperty $REG_PATH 'NoModify'        1 -Type DWord
Set-ItemProperty $REG_PATH 'EstimatedSize'   500000 -Type DWord
$iconPath = "$InstallDir\tray.ico"
if (Test-Path $iconPath) { Set-ItemProperty $REG_PATH 'DisplayIcon' "$iconPath,0" }
Write-OK "Зареєстровано в 'Програми та компоненти' (версія $version)"

# ── Ярлики (Робочий стіл + Start Menu) ────────────────────────────────────────
$iconLine = if (Test-Path $iconPath) { "IconFile=$iconPath`r`nIconIndex=0" } else { '' }

# Ярлик на робочому столі (.url відкривається в браузері за замовчуванням)
Set-Content "$env:USERPROFILE\Desktop\Пекарня.url" `
    "[InternetShortcut]`r`nURL=http://localhost:8000`r`n$iconLine" -Encoding UTF8

# Start Menu
$startDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Пекарня"
New-Item -ItemType Directory -Path $startDir -Force | Out-Null
Set-Content "$startDir\Відкрити Пекарня.url" `
    "[InternetShortcut]`r`nURL=http://localhost:8000`r`n$iconLine" -Encoding UTF8
Write-OK "Ярлики створено (Робочий стіл + Start Menu)"

# ── КРОК 10: Запуск ───────────────────────────────────────────────────────────
Write-Step 'Запуск застосунку'

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
        if ((Invoke-WebRequest 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
            $ready = $true; break
        }
    } catch { }
    Write-Host "    [$i/30]" -ForegroundColor DarkGray -NoNewline
    Write-Host "`r" -NoNewline
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
Start-ScheduledTask $TRAY_TASK -ErrorAction SilentlyContinue

# ── Фінал ─────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║   ✓  Встановлення успішно завершено!         ║' -ForegroundColor Green
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  Застосунок:   ' -NoNewline; Write-Host 'http://localhost:8000' -ForegroundColor Cyan
Write-Host "  Папка:        $InstallDir" -ForegroundColor Gray
Write-Host "  GitHub:       $githubLogin" -ForegroundColor Gray
Write-Host '  Автозапуск:   при кожному вході в систему' -ForegroundColor Gray
if ($useGit) { Write-Host '  Оновлення:    запустіть update.bat' -ForegroundColor Gray }
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
