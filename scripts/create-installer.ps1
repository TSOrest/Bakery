<#
.SYNOPSIS
    Генерує дистрибутивний Bakery-Setup.bat з вбудованим OAuth App client_id.

.DESCRIPTION
    Бере scripts\Bakery-Setup.ps1 як шаблон, вставляє GitHub OAuth App ClientId і
    зберігає готовий файл як Bakery-Setup.bat у корені проекту.

    Клієнт отримує .bat файл і запускає його подвійним кліком — Windows одразу
    виконує його (на відміну від .ps1, який відкривається в Блокноті).
    .bat містить вбудований PowerShell-скрипт, витягує його у %TEMP% і запускає.

.PARAMETER ClientId
    GitHub OAuth App client_id (публічний, без секрету).
    Отримується у: github.com → Settings → Developer settings → OAuth Apps.

.PARAMETER OutFile
    Шлях до вихідного файлу (default: .\Bakery-Setup.bat у корені проекту).

.EXAMPLE
    scripts\create-installer.ps1 -ClientId "Ov23liXXXXXXXXXXXXXX"
    scripts\create-installer.ps1 -ClientId "Ov23liXXX" -OutFile "C:\share\Bakery-Setup.bat"

.NOTES
    Щоб заблокувати клієнта — видаліть його GitHub-акаунт зі співробітників репозиторію.
#>
param(
    [string]$ClientId = '',   # якщо не вказано — використовується значення з шаблону
    [string]$OutFile  = ''
)

$ROOT     = Split-Path -Parent $PSScriptRoot
$template = Join-Path $PSScriptRoot 'Bakery-Setup.ps1'
$out      = if ($OutFile) { $OutFile } else { Join-Path $ROOT 'Bakery-Setup.bat' }

if (-not (Test-Path $template)) {
    Write-Host "ПОМИЛКА: шаблон не знайдено: $template" -ForegroundColor Red
    exit 1
}

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
    # Витягуємо ClientId що вже є в шаблоні для відображення
    if ($ps1Content -match "\`$GITHUB_CLIENT_ID\s*=\s*'([^']+)'") {
        Write-Host "  ClientId: з шаблону ($($Matches[1].Substring(0, [Math]::Min(8,$Matches[1].Length)))...)" -ForegroundColor Gray
    } else {
        Write-Host "ПОПЕРЕДЖЕННЯ: `$GITHUB_CLIENT_ID порожній у шаблоні — клієнт не зможе авторизуватись!" -ForegroundColor Red
    }
}

# ── BAT-заголовок (launcher) ─────────────────────────────────────────────────
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

# ── Записуємо фінальний файл ─────────────────────────────────────────────────
$finalContent = $batHeader + $ps1Content
[IO.File]::WriteAllText($out, $finalContent, [Text.Encoding]::UTF8)

Write-Host ''
Write-Host "  Готово: $out" -ForegroundColor Green
Write-Host ''
Write-Host '  Передайте клієнту цей .bat файл.' -ForegroundColor Gray
Write-Host '  Клієнт запускає подвійним кліком — відкриється майстер встановлення.' -ForegroundColor Gray
Write-Host ''
Write-Host '  Щоб заблокувати доступ — видаліть акаунт клієнта зі співробітників репо.' -ForegroundColor Gray
Write-Host ''
