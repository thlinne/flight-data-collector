# Provider Adapters

Adapters implement `FlightDataProviderAdapter`.

Implemented:
- `MockProviderAdapter`
- `RapidFlightRadarProviderAdapter`, env key `RAPIDAPI_KEY`, BBOX endpoint via `RAPID_FLIGHT_RADAR_HOST`
- `RapidAdsbExchangeProviderAdapter`, env key `RAPIDAPI_KEY`, radius endpoint via `RAPID_ADSBEXCHANGE_HOST`

Skeletons:
- `Fr24ProviderAdapter`, env key `FR24_API_KEY`
- `PlaneFinderProviderAdapter`, env key `PLANE_FINDER_API_KEY`
- `AirNavRadarBoxProviderAdapter`, env key `AIRNAV_API_KEY`
- `FlightAwareProviderAdapter`, env key `FLIGHTAWARE_API_KEY`

## RapidAPI ADSBexchange

ADSBexchange uses point-and-radius queries, not country BBOX queries:

```text
GET /v2/lat/{lat}/lon/{lon}/dist/{dist}/
```

The v1 adapter derives a temporary center point from the country BBOX and uses `RAPID_ADSBEXCHANGE_RADIUS_NM`, defaulting to `20`. Keep this provider disabled until a deliberate country/provider test is started, because larger radii can increase response bandwidth and RapidAPI cost exposure.

Useful mapped fields include ICAO24 (`hex`), callsign (`flight`), registration (`r`), aircraft type (`t`), position, altitude, speed, heading and squawk.

TODO for real integrations:
- Confirm official endpoint URLs and query formats.
- Add request signing/header requirements.
- Map official response payloads to `ProviderNormalizedRecord`.
- Capture provider rate-limit and credit metadata.
- Add provider-specific fixture files and mapping tests.
