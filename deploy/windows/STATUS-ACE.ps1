Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ComposeFile = Join-Path $RepoRoot "infra\docker-compose.yml"

Push-Location $RepoRoot
try {
  docker compose -f $ComposeFile ps
  Write-Host ""
  Write-Host "Dashboard: http://localhost:3000"
  Write-Host "API:       http://localhost:4000/health"
} finally {
  Pop-Location
}
