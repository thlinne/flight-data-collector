# Provider Adapters

Adapters implement `FlightDataProviderAdapter`.

Implemented:
- `RapidFlightRadarProviderAdapter`, env key `RAPIDAPI_KEY`, BBOX endpoint via `RAPID_FLIGHT_RADAR_HOST`
- `RapidAdsbExchangeProviderAdapter`, env key `RAPIDAPI_KEY`, radius endpoint via `RAPID_ADSBEXCHANGE_HOST`
- `RapidSkyLinkProviderAdapter`, env key `RAPIDAPI_KEY`, server-side BBOX live endpoint via `RAPID_SKYLINK_HOST`
- `PlaneFinderProviderAdapter`, env key `PLANE_FINDER_API_KEY`, official BBOX live endpoint via `PLANE_FINDER_BASE_URL`

Provider placeholders are intentionally not kept in the runtime. New providers should be added only after the API endpoint, payload shape and cost model have been reviewed.

## RapidAPI ADSBexchange

ADSBexchange uses point-and-radius queries, not country BBOX queries:

```text
GET /v2/lat/{lat}/lon/{lon}/dist/{dist}/
```

The v1 adapter derives a temporary center point from the country BBOX and uses `RAPID_ADSBEXCHANGE_RADIUS_NM`, defaulting to `20`. Keep this provider disabled until a deliberate country/provider test is started, because larger radii can increase response bandwidth and RapidAPI cost exposure.

Useful mapped fields include ICAO24 (`hex`), callsign (`flight`), registration (`r`), aircraft type (`t`), position, altitude, speed, heading and squawk.

## RapidAPI SkyLink

SkyLink Pro live ADS-B is integrated through:

```text
GET /adsb/aircraft?photos=false&bbox={south},{west},{north},{east}
```

The adapter uses SkyLink's server-side BBOX filter and then applies the local country BBOX again as a safety check. Historical ADS-B is intentionally backlogged until endpoint access and credit impact are verified.

## Plane Finder API

Plane Finder Growth live data is integrated through the official API:

```text
GET /v1/live/aircraft?min_lat={south}&max_lat={north}&min_lon={west}&max_lon={east}&per_page=1000
Authorization: Bearer {PLANE_FINDER_API_KEY}
```

The adapter stores the full raw response and maps aircraft records from `data[]` into normalized observations. It follows cursor pagination up to `PLANE_FINDER_MAX_PAGES_PER_FETCH`, defaulting to 3 pages. Standard live requests are used first because they cost 10 credits; the extended endpoint is intentionally not used for the initial provider comparison.

Plane Finder historical snapshot data is integrated through:

```text
GET /v1/historic/aircraft/{unixTimestamp}?min_lat={south}&max_lat={north}&min_lon={west}&max_lon={east}&per_page=1000
Authorization: Bearer {PLANE_FINDER_API_KEY}
```

This endpoint answers "what aircraft were visible in this BBOX at this timestamp?" One request is one snapshot, not a date range. The dashboard exposes a manual single-snapshot queue for controlled testing. Larger historical backfills must remain explicit budgeted jobs because every snapshot consumes provider credits.

TODO for real integrations:
- Confirm official endpoint URLs and query formats.
- Add request signing/header requirements.
- Map official response payloads to `ProviderNormalizedRecord`.
- Capture provider rate-limit and credit metadata.
- Add provider-specific fixture files and mapping tests.
