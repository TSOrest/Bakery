<#
.SYNOPSIS
    Генерує інсталятор Bakery-Setup.ps1 з вбудованими даними.
    Запускати на машині розробника. Згенерований файл НЕ комітити в git.

.EXAMPLE
    scripts\create-installer.ps1 `
        -DeployToken   "github_pat_xxx" `
        -ClientId      "Ov23livInSt2afY13irB" `
        -ClientSecret  "859ecfd6d98f6ebb9b388e70639fda7e45ce9b4a" `
        -InstallDir    "C:\Пекарня"
#>
param(
    [Parameter(Mandatory)][string]$DeployToken,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$ClientSecret,
    [string]$InstallDir  = 'C:\Пекарня',
    [string]$RepoUrl     = 'https://github.com/TSOrest/Bakery.git',
    [string]$OutFile     = 'Bakery-Setup.ps1'
)

$ROOT = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $ROOT $OutFile

$cloneUrl = $RepoUrl -replace 'https://', "https://x-access-token:$DeployToken@"

$content = @"
<#  Bakery — інсталятор  #>
Set-StrictMode -Off
`$ErrorActionPreference = 'Stop'
`$INSTALL_DIR     = '$InstallDir'
`$CLONE_URL       = '$cloneUrl'
`$GITHUB_CLIENT_ID     = '$ClientId'
`$GITHUB_CLIENT_SECRET = '$ClientSecret'
`$REPO            = 'TSOrest/Bakery'

function Write-Step(`$msg) { Write-Host "  `$msg" -ForegroundColor Cyan }
function Write-Ok(`$msg)   { Write-Host "  OK: `$msg" -ForegroundColor Green }
function Write-Err(`$msg)  { Write-Host "  ПОМИЛКА: `$msg" -ForegroundColor Red; Read-Host 'Enter для виходу'; exit 1 }

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   Bakery -- Встановлення застосунку'       -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

# ── 1. Перевірка передумов ────────────────────────────────────────────────────
Write-Step 'Перевірка Python...'
try { `$pyVer = (python --version 2>&1); Write-Ok `$pyVer }
catch { Write-Err 'Python не знайдено. Встановіть з https://python.org (додайте до PATH)' }

Write-Step 'Перевірка Node.js...'
try { `$nodeVer = (node --version 2>&1); Write-Ok "Node `$nodeVer" }
catch { Write-Err 'Node.js не знайдено. Встановіть з https://nodejs.org' }

Write-Step 'Перевірка Git...'
try { `$gitVer = (git --version 2>&1); Write-Ok `$gitVer }
catch { Write-Err 'Git не знайдено. Встановіть з https://git-scm.com' }

# ── 2. Клонування репозиторію ─────────────────────────────────────────────────
Write-Step "Завантаження коду у `$INSTALL_DIR ..."
if (Test-Path `$INSTALL_DIR) {
    `$confirm = Read-Host "Тека вже існує. Перезаписати? (y/n)"
    if (`$confirm -ne 'y') { Write-Host 'Скасовано.' -ForegroundColor Yellow; exit 0 }
    Remove-Item `$INSTALL_DIR -Recurse -Force
}
`$gitResult = git clone `$CLONE_URL "`$INSTALL_DIR" 2>&1
if (`$LASTEXITCODE -ne 0) { Write-Err "git clone не вдався: `$gitResult" }

# Прибрати токен з remote URL щоб не зберігався у .git/config відкрито
`$safeUrl = 'https://github.com/TSOrest/Bakery.git'
git -C "`$INSTALL_DIR" remote set-url origin `$safeUrl | Out-Null
# Зберегти токен для майбутніх fetch/pull (оновлень)
`$credLine = "https://x-access-token:`$DEPLOY_TOKEN_PLACEHOLDER@github.com"
# Токен зберігається у git credential store
git -C "`$INSTALL_DIR" config credential.helper store | Out-Null
[System.IO.File]::WriteAllText(
    (Join-Path `$env:USERPROFILE '.git-credentials'),
    "https://x-access-token:$DeployToken@github.com`n",
    [System.Text.Encoding]::UTF8
)
Write-Ok 'Код завантажено'

# ── 3. Встановлення Python-залежностей та бази даних ─────────────────────────
Write-Step 'Встановлення залежностей (install.bat)...'
`$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c install.bat' ``
    -WorkingDirectory "`$INSTALL_DIR" -Wait -PassThru -NoNewWindow
if (`$proc.ExitCode -ne 0) { Write-Err 'install.bat завершився з помилкою' }
Write-Ok 'Залежності встановлені'

# ── 4. Запис OAuth App credentials в базу даних ──────────────────────────────
Write-Step 'Налаштування системи звернень (GitHub OAuth)...'
`$python = Join-Path `$INSTALL_DIR 'backend\venv\Scripts\python.exe'
`$script = @"
import sys
sys.path.insert(0, r'`$INSTALL_DIR')
from backend.database import engine
from backend.models.settings import Setting
from sqlalchemy.orm import Session
pairs = [
    ('github_client_id',     r'`$GITHUB_CLIENT_ID',     'GitHub OAuth App Client ID'),
    ('github_client_secret', r'`$GITHUB_CLIENT_SECRET', 'GitHub OAuth App Client Secret'),
    ('github_repo',          '$REPO',                   'GitHub репозиторій (owner/repo)'),
]
with Session(engine) as db:
    for key, val, desc in pairs:
        row = db.get(Setting, key)
        if row:
            row.value = val
        else:
            db.add(Setting(key=key, value=val, description=desc))
    db.commit()
print('OK')
"@
`$tmpScript = Join-Path `$env:TEMP 'bakery_set_token.py'
[System.IO.File]::WriteAllText(`$tmpScript, `$script, [System.Text.Encoding]::UTF8)
`$result = & `$python `$tmpScript 2>&1
Remove-Item `$tmpScript -ErrorAction SilentlyContinue
if (`$result -notmatch 'OK') { Write-Host "  Увага: `$result" -ForegroundColor Yellow }
else { Write-Ok 'GitHub OAuth App налаштовано' }

# ── 5. Реєстрація автозапуску та запуск ──────────────────────────────────────
Write-Step 'Реєстрація автозапуску (install-service.bat)...'
`$proc2 = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c install-service.bat' ``
    -WorkingDirectory "`$INSTALL_DIR" -Wait -PassThru -NoNewWindow
if (`$proc2.ExitCode -ne 0) { Write-Err 'install-service.bat завершився з помилкою' }
Write-Ok 'Автозапуск зареєстровано'

# ── Готово ────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host '   Встановлення завершено успішно!'         -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Застосунок: http://localhost:8000"
Write-Host "  Логи:       `$INSTALL_DIR\logs\bakery.log"
Write-Host ''
Write-Host "  НАСТУПНИЙ КРОК: відкрийте браузер → Довідники → Налаштування"
Write-Host "  і натисніть 'Авторизуватись через GitHub' — увійдіть акаунтом пекарні."
Write-Host "  Після цього система звернень та оновлення будуть працювати від вашого акаунту."
Write-Host ''
Read-Host 'Натисніть Enter для виходу'
"@

Set-Content -Path $out -Value $content -Encoding UTF8
Write-Host "Інсталятор створено: $out" -ForegroundColor Green
Write-Host "УВАГА: не додавайте $OutFile у git-репозиторій (він містить токени)" -ForegroundColor Yellow
