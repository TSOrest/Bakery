<#
.SYNOPSIS
    Генерує дистрибутивний інсталятор Пекарні (.bat або .exe).

.DESCRIPTION
    Бере scripts\Bakery-Setup.ps1 як шаблон, вставляє GitHub OAuth App ClientId і
    зберігає готовий файл.

    За замовчуванням генерує Bakery-Setup.bat — клієнт запускає подвійним кліком.
    З параметром -Exe компілює за допомогою ps2exe у справжній .exe файл.

.PARAMETER ClientId
    GitHub OAuth App client_id (публічний, без секрету).
    Отримується у: github.com → Settings → Developer settings → OAuth Apps.

.PARAMETER OutFile
    Шлях до вихідного файлу (default: .\Bakery-Setup.bat або .\Bakery-Setup.exe).

.PARAMETER Exe
    Компілювати у EXE-файл замість BAT (потребує модуль ps2exe).

.EXAMPLE
    scripts\create-installer.ps1 -ClientId "Ov23liXXXXXXXXXXXXXX"
    scripts\create-installer.ps1 -ClientId "Ov23liXXX" -Exe
    scripts\create-installer.ps1 -ClientId "Ov23liXXX" -Exe -OutFile "C:\share\Bakery-Setup.exe"
#>
param(
    [string]$ClientId = '',   # якщо не вказано — використовується значення з шаблону
    [string]$OutFile  = '',
    [switch]$Exe                # компілювати у .exe через ps2exe
)

$ROOT     = Split-Path -Parent $PSScriptRoot
$template = Join-Path $PSScriptRoot 'Bakery-Setup.ps1'

if (-not (Test-Path $template)) {
    Write-Host "ПОМИЛКА: шаблон не знайдено: $template" -ForegroundColor Red
    exit 1
}

# Визначаємо вихідний файл залежно від режиму
$defaultExt = if ($Exe) { 'exe' } else { 'bat' }
$out = if ($OutFile) { $OutFile } else { Join-Path $ROOT "Bakery-Setup.$defaultExt" }

# ── Читаємо і патчимо шаблон ────────────────────────────────────────────────
$ps1Content = Get-Content $template -Raw -Encoding UTF8

if ($ClientId) {
    $before = $ps1Content
    $ps1Content = $ps1Content -replace `
        "(\`$GITHUB_CLIENT_ID\s*=\s*)'[^']*'", `
        "`$1'$ClientId'"
    if ($ps1Content -eq $before) {
        Write-Host "ПОМИЛКА: рядок з `$GITHUB_CLIENT_ID не знайдено у шаблоні." -ForegroundColor Red
        exit 1
    }
    Write-Host "  ClientId: замінено на $($ClientId.Substring(0, [Math]::Min(8,$ClientId.Length)))..." -ForegroundColor Yellow
} else {
    if ($ps1Content -match "\`$GITHUB_CLIENT_ID\s*=\s*'([^']+)'") {
        Write-Host "  ClientId: з шаблону ($($Matches[1].Substring(0, [Math]::Min(8,$Matches[1].Length)))...)" -ForegroundColor Gray
    } else {
        Write-Host "ПОПЕРЕДЖЕННЯ: `$GITHUB_CLIENT_ID порожній у шаблоні — клієнт не зможе авторизуватись!" -ForegroundColor Red
    }
}

# ── Режим EXE (ps2exe) ────────────────────────────────────────────────────────
if ($Exe) {
    # Перевіряємо/встановлюємо ps2exe
    if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
        Write-Host '  Встановлення модуля ps2exe...' -ForegroundColor Yellow
        Install-Module -Name ps2exe -Scope CurrentUser -Force -ErrorAction Stop
        Import-Module ps2exe -Force
    }

    # Читаємо версію з файлу VERSION
    $versionFile = Join-Path $ROOT 'VERSION'
    $appVersion  = if (Test-Path $versionFile) {
        (Get-Content $versionFile -Encoding UTF8).Trim().TrimStart([char]0xFEFF).TrimStart('v')
    } else { '1.0.0' }
    # EXE версія має формат X.X.X.X
    $exeVersion = ($appVersion -replace '[^0-9.]') -replace '^\.+|\.+$'
    $parts = $exeVersion.Split('.')
    while ($parts.Count -lt 4) { $parts += '0' }
    $exeVersion = ($parts[0..3]) -join '.'

    # Іконка — якщо є у папці scripts
    $iconArg = @{}
    $iconPath = Join-Path $PSScriptRoot 'bakery.ico'
    if (Test-Path $iconPath) { $iconArg['iconFile'] = $iconPath }

    # Записуємо патчений PS1 у тимчасовий файл
    $tmpPs1 = Join-Path $env:TEMP "BakerySetup_$PID.ps1"
    [IO.File]::WriteAllText($tmpPs1, $ps1Content, [Text.Encoding]::UTF8)

    try {
        Write-Host "  Компіляція ps2exe → $out ..." -ForegroundColor Yellow
        $ps2exeParams = @{
            inputFile   = $tmpPs1
            outputFile  = $out
            title       = 'Пекарня — Встановлення'
            description = 'Майстер встановлення системи Пекарня'
            company     = 'TSOrest'
            version     = $exeVersion
            requireAdmin = $true
            noConsole   = $false          # потрібна консоль для виводу прогресу
            x64         = $true
        }
        if ($iconArg.Count) { $ps2exeParams += $iconArg }
        Invoke-ps2exe @ps2exeParams
    } finally {
        Remove-Item $tmpPs1 -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $out)) {
        Write-Host "ПОМИЛКА: EXE не створено." -ForegroundColor Red
        exit 1
    }

    $sizeMb = [Math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Host ''
    Write-Host "  Готово: $out  ($sizeMb MB)" -ForegroundColor Green
    Write-Host ''
    Write-Host '  Передайте клієнту цей .exe файл.' -ForegroundColor Gray
    Write-Host '  Клієнт запускає подвійним кліком — запустить майстер встановлення з правами адміна.' -ForegroundColor Gray
    Write-Host ''
    exit 0
}

# ── Режим BAT (стандартний) ───────────────────────────────────────────────────
# Клієнт двічі клікає .bat → Windows запускає CMD → CMD витягує вбудований
# PS1 з решти файлу (після рядка-маркера #__PS1__) у %TEMP% і виконує його.
$batHeader = @'
@echo off
chcp 65001 >nul 2>&1
title Пекарня — Встановлення
set "SELF=%~f0"
set "TMP_PS=%TEMP%\BakerySetup%RANDOM%.ps1"
echo.
echo   Завантаження майстра встановлення...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=$env:SELF; $l=[IO.File]::ReadAllLines($f,[Text.Encoding]::UTF8); $s=0; for($i=0;$i-lt$l.Count;$i++){if($l[$i]-eq'#__PS1__'){$s=$i+1;break}}; [IO.File]::WriteAllLines($env:TMP_PS,$l[$s..($l.Count-1)],[Text.Encoding]::UTF8)"
if not exist "%TMP_PS%" ( echo   ПОМИЛКА: не вдалося підготувати встановлення. & pause & exit /b 1 )
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%"
del "%TMP_PS%" 2>nul
exit /b
#__PS1__
'@

$finalContent = $batHeader + "`r`n" + $ps1Content
[IO.File]::WriteAllText($out, $finalContent, [Text.Encoding]::UTF8)

Write-Host ''
Write-Host "  Готово: $out" -ForegroundColor Green
Write-Host ''
Write-Host '  Передайте клієнту цей .bat файл.' -ForegroundColor Gray
Write-Host '  Клієнт запускає подвійним кліком — відкриється майстер встановлення.' -ForegroundColor Gray
Write-Host ''
Write-Host '  Щоб заблокувати доступ — видаліть акаунт клієнта зі співробітників репо.' -ForegroundColor Gray
Write-Host ''

