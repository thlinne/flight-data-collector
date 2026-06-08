# SkyLink Live ADS-B BBOX Decision

Date: 2026-06-08

## Decision

SkyLink live collection must call the live ADS-B endpoint with a server-side bounding box filter:

```http
GET https://skylink-api.p.rapidapi.com/adsb/aircraft?bbox={south},{west},{north},{east}&photos=false
```

The previous implementation called the same global endpoint for every country with `offset=0` and then filtered locally. That produced weak provider comparison data because each country received only a global first page/snapshot, not a country-specific live feed.

## Rationale

SkyLink documentation states that `/adsb/aircraft` supports geographic filters, including `bbox` and radius. For our provider comparison, SkyLink should be queried as closely as possible to Flight Radar's country BBOX method.

Local BBOX filtering remains as a defensive second pass after the API response is received. This protects the normalized store if the provider returns records outside the requested bounds.

## Operational Notes

- `photos=false` is kept to reduce latency and payload size.
- The complete provider response is still stored in `RawProviderResponse` before normalization.
- Request metadata records the BBOX string and the original BBOX object.
- Historical SkyLink ADS-B remains out of scope for the current live-data comparison.
