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

# ── Конфігурація (заповнюється через create-installer.ps1) ────────────────────
$GITHUB_CLIENT_ID = 'Ov23livInSt2afY13irB'  # OAuth App client_id (публічний, не секрет)
$REPO_OWNER       = 'TSOrest'
$REPO_NAME        = 'Bakery'
$REPO_URL         = "https://github.com/$REPO_OWNER/$REPO_NAME.git"
$APP_TASK         = 'BakeryApp'
$TRAY_TASK        = 'BakeryTray'
$MIN_PYTHON       = [Version]'3.11'
$MIN_NODE         = 18

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
Write-Host '  Для встановлення необхідний обліковий запис GitHub,' -ForegroundColor Gray
Write-Host '  який надано розробником разом з цим файлом.' -ForegroundColor Gray
Write-Host ''

# ── КРОК 1: Вибір папки ───────────────────────────────────────────────────────
Write-Step 'Вибір папки встановлення'

if (-not $InstallDir) {
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

$isUpdate = $false
if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -gt 0) {
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
        $pyInst = "$env:TEMP\python-setup-$PID.exe"
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
        $nodeInst = "$env:TEMP\node-setup-$PID.msi"
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

$cloneUrl = "https://x-access-token:$accessToken@github.com/$REPO_OWNER/$REPO_NAME.git"
$gitExe   = (Get-Command git -ErrorAction SilentlyContinue).Source
$useGit   = $false

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
        $zipFile = "$env:TEMP\bakery-master-$PID.zip"
        $zipTemp = "$env:TEMP\bakery-zip-$PID"
        Write-Info 'Завантаження ZIP архіву...'
        Invoke-WebRequest $zipUrl -OutFile $zipFile -UseBasicParsing `
            -Headers @{ Authorization = "Bearer $accessToken"; 'User-Agent' = 'BakeryApp-Installer/1.0' }
        Expand-Archive $zipFile -DestinationPath $zipTemp -Force
        $inner = (Get-ChildItem $zipTemp | Select-Object -First 1).FullName
        if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item "$inner\*" -Destination $InstallDir -Recurse -Force
        Remove-Item $zipFile, $zipTemp -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK 'Код завантажено (ZIP)'
        Write-Warn 'Git не встановлено — автооновлення недоступне.'
    }
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

$escapedDir   = $InstallDir.Replace('\', '\\')
$escapedToken = $accessToken.Replace("'", "\\'")
$escapedLogin = $githubLogin.Replace("'", "\\'")

$dbScript = @"
import sqlite3, pathlib

root    = pathlib.Path(r'$escapedDir')
db_path = root / 'bakery.db'

def open_db():
    c = sqlite3.connect(str(db_path))
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA foreign_keys=ON')
    return c

db = open_db()

def run_sql(sql_text, strict=False):
    for stmt in sql_text.split(';'):
        # Прибираємо рядки-коментарі перед SQL-командою
        lines = [l for l in stmt.splitlines() if not l.strip().startswith('--')]
        stmt = '\n'.join(lines).strip()
        if not stmt:
            continue
        if strict:
            db.execute(stmt)
        else:
            try:
                db.execute(stmt)
            except Exception:
                pass
    db.commit()

# При повторному встановленні — завжди починаємо з чистої БД
db.close()
for suffix in ('', '-wal', '-shm'):
    p = pathlib.Path(str(db_path) + suffix)
    if p.exists():
        p.unlink()
db = open_db()
run_sql((root / 'database' / 'schema.sql').read_text('utf-8'), strict=True)
print('Schema applied.')

mig_dir = root / 'database' / 'migrations'
if mig_dir.exists():
    for f in sorted(mig_dir.glob('*.sql')):
        run_sql(f.read_text('utf-8'))
        print(f'  {f.name}')

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

$tmpScript = "$env:TEMP\bakery_db_init_$PID.py"
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

$logsDir = "$InstallDir\logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory $logsDir | Out-Null }

# Генеруємо run-server.ps1 з правильними шляхами
$rootQ   = $InstallDir.Replace("'", "''")
$pythonQ = $venvPython.Replace("'", "''")
$serverScript = @"
# Bakery server launcher — auto-generated by Bakery-Setup.ps1
`$log    = '$rootQ\logs\bakery.log'
`$python = '$pythonQ'
taskkill /F /IM python.exe /T 2>`$null
Start-Sleep -Seconds 1
Add-Content `$log ("`n[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
Set-Location '$rootQ'
& `$python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content `$log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), `$_) }
"@
Set-Content "$InstallDir\scripts\run-server.ps1" $serverScript -Encoding UTF8

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask $APP_TASK -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask $APP_TASK `
    -Action   (New-ScheduledTaskAction `
                  -Execute 'powershell.exe' `
                  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\scripts\run-server.ps1`"" `
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
