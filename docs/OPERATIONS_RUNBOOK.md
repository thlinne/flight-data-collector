# Operations Runbook

## Daily Checks

- Open System Health and confirm collector heartbeat is current.
- Open System Alerts and review open critical/warning alerts.
- Check failed fetches from the last 24 hours.
- Confirm PostgreSQL and Redis containers are healthy.

## Alert Actions

- Acknowledge: confirms the alert has been seen.
- Resolve: closes the alert after the underlying issue is handled.
- Related provider/country/raw links help scope the incident.

Email and webhook channels are schema-ready placeholders for v1.
