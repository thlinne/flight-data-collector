Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Adding Windows Firewall rules for Flight Data Collector LAN access." -ForegroundColor Cyan

New-NetFirewallRule `
  -DisplayName "Flight Data Collector Dashboard 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow `
  -ErrorAction SilentlyContinue

New-NetFirewallRule `
  -DisplayName "Flight Data Collector API 4000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 4000 `
  -Action Allow `
  -ErrorAction SilentlyContinue

Write-Host "LAN firewall rules added. Use http://ACE-IP:3000 from another device in the same network." -ForegroundColor Green
