# Provider Adapters

Adapters implement `FlightDataProviderAdapter`.

Implemented:
- `MockProviderAdapter`

Skeletons:
- `Fr24ProviderAdapter`, env key `FR24_API_KEY`
- `PlaneFinderProviderAdapter`, env key `PLANE_FINDER_API_KEY`
- `AirNavRadarBoxProviderAdapter`, env key `AIRNAV_API_KEY`
- `FlightAwareProviderAdapter`, env key `FLIGHTAWARE_API_KEY`

TODO for real integrations:
- Confirm official endpoint URLs and query formats.
- Add request signing/header requirements.
- Map official response payloads to `ProviderNormalizedRecord`.
- Capture provider rate-limit and credit metadata.
- Add provider-specific fixture files and mapping tests.
