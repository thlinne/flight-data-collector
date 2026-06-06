# Data Model

The schema preserves source evidence and normalized records.

Primary entities:
- `Provider`, `Country`, `CollectionArea`
- `ProviderCountryConfig` for runtime polling, rate limits, credits and enabled flags
- `ProviderFetchRun` for successful and failed fetch attempts
- `RawProviderResponse` for complete provider payloads
- `RawFlightObservation` for normalized observation fields and raw record JSON
- `CountryObservationTag` for country/area tagging
- `AlertRule`, `AlertEvent`, `CollectorHeartbeat`

All timestamps are UTC. Initial country geometry uses approximate bounding boxes with `geometryQuality = APPROXIMATE_BBOX`.
