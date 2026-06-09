param(
  [string]$ComposeFile = "infra/docker-compose.yml"
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$sqlFile = Join-Path $repoRoot "infra\postgres\runtime-indexes.sql"

if (-not (Test-Path $sqlFile)) {
  throw "Index SQL file not found: $sqlFile"
}

Set-Location $repoRoot
Write-Host "Applying runtime indexes with CREATE INDEX CONCURRENTLY..."
Get-Content $sqlFile | docker compose -f $ComposeFile exec -T postgres psql -U flight_collector -d flight_data_collector
Write-Host "Runtime index update completed."
