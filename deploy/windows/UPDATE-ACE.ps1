Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ComposeFile = Join-Path $RepoRoot "infra\docker-compose.yml"
$PackageJson = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json

Write-Host "Flight Data Collector ACE update" -ForegroundColor Cyan
Write-Host ("Version: ver {0}" -f $PackageJson.version) -ForegroundColor Cyan
Write-Host "This rebuilds application containers and preserves the PostgreSQL volume." -ForegroundColor Yellow
Write-Host "Do not run docker compose down -v on ACE." -ForegroundColor Yellow

docker info *> $null

Push-Location $RepoRoot
try {
  docker compose -f $ComposeFile build --pull
  docker compose -f $ComposeFile up -d
  Write-Host ""
  Write-Host "ACE update complete." -ForegroundColor Green
  docker compose -f $ComposeFile ps
} finally {
  Pop-Location
}
