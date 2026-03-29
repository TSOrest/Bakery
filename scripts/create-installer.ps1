<#
.SYNOPSIS
    Генерує дистрибутивний Bakery-Setup.ps1 з вбудованим OAuth App client_id.

.DESCRIPTION
    Бере scripts\Bakery-Setup.ps1 як шаблон, вставляє GitHub OAuth App ClientId і зберігає
    готовий файл у корені проекту. Цей файл НЕ комітять у git — він
    передається клієнту напряму (email, USB, сайт).

    Під час встановлення клієнт авторизується зі своїм GitHub-акаунтом через
    Device Flow OAuth (github.com/login/device). Client ID — публічний ідентифікатор
    OAuth App розробника, не є секретом.

.PARAMETER ClientId
    GitHub OAuth App client_id (публічний, без секрету).
    Отримується у: github.com → Settings → Developer settings → OAuth Apps.
    Обов'язковий параметр — без нього клієнт не зможе авторизуватись.

.PARAMETER OutFile
    Шлях до вихідного файлу (default: .\Bakery-Setup.ps1 у корені проекту).

.EXAMPLE
    scripts\create-installer.ps1 -ClientId "Ov23liXXXXXXXXXXXXXX"
    scripts\create-installer.ps1 -ClientId "Ov23liXXX" -OutFile "C:\share\Bakery-Setup.ps1"

.NOTES
    Client ID — не секрет, його можна передавати відкрито.
    Клієнт при встановленні авторизується зі своїм GitHub-акаунтом.
    Щоб заблокувати клієнта — видаліть його GitHub-акаунт зі співробітників репозиторію.
#>
param(
    [Parameter(Mandatory)]
    [string]$ClientId,
    [string]$OutFile = ''
)

$ROOT     = Split-Path -Parent $PSScriptRoot
$template = Join-Path $PSScriptRoot 'Bakery-Setup.ps1'
$out      = if ($OutFile) { $OutFile } else { Join-Path $ROOT 'Bakery-Setup.ps1' }

if (-not (Test-Path $template)) {
    Write-Host "ПОМИЛКА: шаблон не знайдено: $template" -ForegroundColor Red
    exit 1
}

$content = Get-Content $template -Raw -Encoding UTF8

# Вставляємо client_id у рядок $GITHUB_CLIENT_ID = ''
$before = $content
$content = $content -replace `
    "(\`$GITHUB_CLIENT_ID\s*=\s*)'[^']*'", `
    "`$1'$ClientId'"

if ($content -eq $before) {
    Write-Host "ПОМИЛКА: рядок з `$GITHUB_CLIENT_ID не знайдено у шаблоні." -ForegroundColor Red
    exit 1
}

Write-Host "  ClientId: вбудовано ($($ClientId.Substring(0, [Math]::Min(8,$ClientId.Length)))...)" -ForegroundColor Yellow

[IO.File]::WriteAllText($out, $content, [Text.Encoding]::UTF8)

Write-Host ''
Write-Host "  Готово: $out" -ForegroundColor Green
Write-Host ''
Write-Host '  Передайте клієнту цей файл і скажіть запустити:' -ForegroundColor Gray
Write-Host '  powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1' -ForegroundColor Cyan
Write-Host ''
Write-Host '  При встановленні клієнт авторизується зі своїм GitHub-акаунтом.' -ForegroundColor Gray
Write-Host '  Щоб заблокувати доступ — видаліть акаунт клієнта зі співробітників репо.' -ForegroundColor Gray
Write-Host ''
