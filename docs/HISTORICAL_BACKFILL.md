# Historical Backfill

## Plane Finder single snapshot

Plane Finder historical aircraft positions are implemented first as a deliberately small manual snapshot job:

- provider
- country
- timestamp

The worker calls:

```text
GET /v1/historic/aircraft/{unixTimestamp}
```

with the same country BBOX parameters used by the live Plane Finder endpoint:

```text
min_lat={south}
max_lat={north}
min_lon={west}
max_lon={east}
per_page=1000
```

The result is stored through the normal raw response and raw observation layer with `ProviderFetchRun.mode = HISTORICAL`. This keeps historical provider data separated by provider while preserving the complete original payload.

Initial test target:

```text
Provider: Plane Finder API
Country: Burundi
Timestamp: 2025-12-15 12:00 UTC
```

## Larger backfills

Month or date-range backfills are intentionally not automatic yet. They must be generated as many explicit snapshot jobs because one Plane Finder historic aircraft request equals one timestamp. Before enabling larger runs, add:

- credit-budget confirmation
- progress tracking
- cancellation/pause
- chunking interval, for example 60 minutes, 30 minutes, or 10 minutes
- provider rate-limit handling
