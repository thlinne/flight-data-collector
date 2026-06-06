# ACE Windows Deployment

ACE is the 24/7 data collector PC. DEV is the developer PC.

This simple deployment does not require Node.js, pnpm, VS Code or Git on ACE. ACE only needs Docker Desktop and the project files.

## Install on ACE

1. Install Docker Desktop.
2. Confirm Docker Desktop says Engine running.
3. Copy or download the project folder to:

```text
C:\FlightDataCollector
```

4. Open PowerShell in:

```text
C:\FlightDataCollector
```

5. Start once:

```powershell
.\deploy\windows\START-ACE.ps1
```

If `.env` does not exist, the script creates it from `.env.example` and stops. Edit `.env` before starting again.

Required `.env` values:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
RAPIDAPI_KEY
```

## Start

```powershell
.\deploy\windows\START-ACE.ps1
```

Dashboard:

```text
http://localhost:3000
```

API health:

```text
http://localhost:4000/health
```

## Stop

```powershell
.\deploy\windows\STOP-ACE.ps1
```

This preserves the PostgreSQL Docker volume.

Never run:

```powershell
docker compose down -v
```

on ACE unless you intentionally want to delete the database volume.

## Update at End of Day

1. On DEV: finish code, run checks, commit and push.
2. Download/copy the updated project files to ACE.
3. Keep ACE `.env`.
4. On ACE run:

```powershell
.\deploy\windows\UPDATE-ACE.ps1
```

The update rebuilds app containers and keeps the PostgreSQL volume.

## Status

```powershell
.\deploy\windows\STATUS-ACE.ps1
```

## LAN Access

To open the dashboard from an iPad or another PC in the same network, allow LAN access once from an Administrator PowerShell:

```powershell
.\deploy\windows\ALLOW-LAN-ACE.ps1
```

Then open:

```text
http://ACE-IP:3000
```

Find ACE IP:

```powershell
ipconfig
```

## Backup

Use the dashboard System Health page and click:

```text
Download database backup
```

Create a manual backup before end-of-day updates.
