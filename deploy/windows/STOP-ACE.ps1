Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ComposeFile = Join-Path $RepoRoot "infra\docker-compose.yml"

Write-Host "Flight Data Collector ACE stop" -ForegroundColor Cyan
Write-Host "Stopping containers without deleting database volumes." -ForegroundColor Yellow

Push-Location $RepoRoot
try {
  docker compose -f $ComposeFile down
  Write-Host "ACE containers stopped. Database volume is preserved." -ForegroundColor Green
} finally {
  Pop-Location
}
