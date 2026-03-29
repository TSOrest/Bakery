<#
.SYNOPSIS
    Генерує дистрибутивний Bakery-Setup.ps1 з вбудованим deploy-токеном.

.DESCRIPTION
    Бере scripts\Bakery-Setup.ps1 як шаблон, вставляє DeployToken і зберігає
    готовий файл у корені проекту. Цей файл НЕ комітять у git — він
    передається клієнту напряму (email, USB, сайт).

.PARAMETER DeployToken
    GitHub Personal Access Token (read-only, scope: contents:read).
    Дозволяє клонувати приватний репозиторій без облікового запису GitHub.

.PARAMETER OutFile
    Шлях до вихідного файлу (default: .\Bakery-Setup.ps1 у корені проекту).

.EXAMPLE
    scripts\create-installer.ps1 -DeployToken "github_pat_xxxxxxxxxxxx"
    scripts\create-installer.ps1 -DeployToken "ghp_xxx" -OutFile "C:\share\Bakery-Setup.ps1"

.NOTES
    УВАГА: Згенерований файл містить токен — не публікуйте його у відкритому доступі.
    Для публічного репозиторію DeployToken не потрібен — просто використовуйте
    scripts\Bakery-Setup.ps1 напряму.
#>
param(
    [string]$DeployToken = '',
    [string]$OutFile     = ''
)

$ROOT     = Split-Path -Parent $PSScriptRoot
$template = Join-Path $PSScriptRoot 'Bakery-Setup.ps1'
$out      = if ($OutFile) { $OutFile } else { Join-Path $ROOT 'Bakery-Setup.ps1' }

if (-not (Test-Path $template)) {
    Write-Host "ПОМИЛКА: шаблон не знайдено: $template" -ForegroundColor Red
    exit 1
}

$content = Get-Content $template -Raw -Encoding UTF8

if ($DeployToken) {
    # Замінюємо порожній DeployToken у рядку param() на реальний
    $content = $content -replace `
        "(\[string\]\`$DeployToken\s*=\s*)'[^']*'", `
        "`$1'$DeployToken'"
    Write-Host "  DeployToken: вбудовано (перші 8 символів: $($DeployToken.Substring(0, [Math]::Min(8,$DeployToken.Length)))...)" -ForegroundColor Yellow
} else {
    Write-Host '  DeployToken: не вказано (публічний репо або ручний ввід)' -ForegroundColor Gray
}

[IO.File]::WriteAllText($out, $content, [Text.Encoding]::UTF8)

Write-Host ''
Write-Host "  Готово: $out" -ForegroundColor Green
Write-Host ''
if ($DeployToken) {
    Write-Host '  УВАГА: файл містить токен — не публікуйте у відкритому доступі!' -ForegroundColor Red
}
Write-Host '  Передайте клієнту цей файл і скажіть запустити:' -ForegroundColor Gray
Write-Host "  powershell -ExecutionPolicy Bypass -File Bakery-Setup.ps1" -ForegroundColor Cyan
Write-Host ''
