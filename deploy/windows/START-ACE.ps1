Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ComposeFile = Join-Path $RepoRoot "infra\docker-compose.yml"
$EnvFile = Join-Path $RepoRoot ".env"
$EnvExample = Join-Path $RepoRoot ".env.example"

Write-Host "Flight Data Collector ACE start" -ForegroundColor Cyan

if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExample $EnvFile
  Write-Host ".env was created from .env.example." -ForegroundColor Yellow
  Write-Host "Edit .env, set ADMIN_PASSWORD and RAPIDAPI_KEY, then run this script again." -ForegroundColor Yellow
  exit 1
}

docker info *> $null

Push-Location $RepoRoot
try {
  docker compose -f $ComposeFile up -d --build
  Write-Host ""
  Write-Host "ACE is starting." -ForegroundColor Green
  Write-Host "Dashboard local: http://localhost:3000"
  Write-Host "API health:      http://localhost:4000/health"
} finally {
  Pop-Location
}
