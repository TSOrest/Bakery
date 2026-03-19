param(
    [Parameter(Mandatory)][string]$Tag,
    [string]$Title = "",
    [string]$Notes = ""
)

$ROOT = Split-Path -Parent $PSScriptRoot

# Update VERSION file
Set-Content -Path (Join-Path $ROOT 'VERSION') -Value $Tag -Encoding UTF8
Write-Host "VERSION updated: $Tag" -ForegroundColor Green

# Commit VERSION
& git -C $ROOT add VERSION
& git -C $ROOT commit -m "feat: bump version to $Tag"
& git -C $ROOT push origin master

# Get GitHub token from git credential store
$credInput = "protocol=https`nhost=github.com`n`n"
$creds = $credInput | git credential fill 2>&1
$token = ($creds | Where-Object { $_ -match '^password=' }) -replace 'password=', ''
if (-not $token) {
    Write-Host 'ERROR: GitHub token not found in git credential store.' -ForegroundColor Red
    exit 1
}

$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}

# Delete existing release + tag if they exist
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/TSOrest/Bakery/releases/tags/$Tag" `
        -Headers $headers -ErrorAction SilentlyContinue
    if ($existing.id) {
        Invoke-RestMethod -Method Delete `
            -Uri "https://api.github.com/repos/TSOrest/Bakery/releases/$($existing.id)" `
            -Headers $headers | Out-Null
        Write-Host "Deleted old release $Tag" -ForegroundColor Yellow
    }
} catch {}

# Create GitHub Release
$releaseTitle = if ($Title) { $Title } else { $Tag }
$obj = [ordered]@{
    tag_name         = $Tag
    target_commitish = 'master'
    name             = $releaseTitle
    body             = $Notes
    draft            = $false
    prerelease       = $false
}

$result = Invoke-RestMethod -Method Post `
    -Uri 'https://api.github.com/repos/TSOrest/Bakery/releases' `
    -Headers $headers `
    -Body ($obj | ConvertTo-Json) `
    -ContentType 'application/json; charset=utf-8'

Write-Host "Release created: $($result.html_url)" -ForegroundColor Green
Write-Host ''
Write-Host "  Tag:   $Tag"
Write-Host "  Title: $releaseTitle"
if ($Notes) {
    Write-Host "  Notes:"
    $Notes -split "`n" | ForEach-Object { Write-Host "    $_" }
}
