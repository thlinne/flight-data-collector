# Provider Debugging Workflow

Date: 2026-06-07

Purpose: debug provider ingestion without involving the scheduler, BullMQ timing, or the dashboard.

## Principle

Move in this order:

1. One provider, one country, one circle.
2. One provider, one country, all circles.
3. One provider, all countries.
4. Scheduler and dashboard last.

## List Available Coverage Circles

```powershell
pnpm debug:provider RAPID_ADSBEXCHANGE LBY --list
```

## Test One Circle Without Storing

```powershell
pnpm debug:provider RAPID_ADSBEXCHANGE LBY --circle "LBY mixed 01 250 NM"
```

On local Windows Node installations, RapidAPI TLS validation may require Windows system certificates:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
pnpm debug:provider RAPID_ADSBEXCHANGE LBY --circle "LBY mixed 13 50 NM"
```

The command prints:

- provider
- country
- circle
- endpoint
- HTTP status where available
- response bytes
- raw aircraft count
- normalized observation count
- in-country BBOX count
- unique ICAO24 count
- example records

## Store One Circle

Only after the dry run returns plausible data:

```powershell
pnpm debug:provider RAPID_ADSBEXCHANGE LBY --circle "LBY mixed 01 250 NM" --store
```

This stores data through the same `storeFetchResult` path used by the collector.

## Raw Data Rule

Do not deduplicate provider raw responses. The debug command and collector both preserve raw responses and raw observations. Deduplication belongs to a later normalized/analytics layer.
