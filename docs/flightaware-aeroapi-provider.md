# FlightAware AeroAPI provider notes

Status: initial live-data integration for provider code `FLIGHTAWARE_AERO` / shorthand `FAP`.

## Decision

FAP is implemented as a BBOX-based live provider using the official FlightAware AeroAPI search endpoint:

`GET https://aeroapi.flightaware.com/aeroapi/flights/search`

Authentication uses the `x-apikey` header with `FLIGHTAWARE_AERO_API_KEY`.

The request uses the AeroAPI query syntax:

`-latlong "south west north east"`

This matches the country BBOX model already used for Plane Finder and RapidAPI Flight Radar, so FAP can be compared in the existing provider-country matrices without introducing coverage circles.

## Scope for v1

- Live observations only.
- One request per provider-country config and scheduler run.
- `FLIGHTAWARE_AERO_MAX_PAGES_PER_FETCH` defaults to `1` until cost and pagination behavior are measured.
- Historical FlightAware queries are intentionally not implemented in this adapter yet.

## Normalization

The adapter maps `flights[].last_position` to normalized observations:

- `ident_icao` / `ident` -> callsign
- `fa_flight_id` -> provider flight id
- `registration` -> provider aircraft id when available
- `aircraft_type` -> aircraft type ICAO
- `origin.code_icao` and `destination.code_icao` -> route airports
- `last_position.latitude`, `last_position.longitude` -> position
- `last_position.altitude` is interpreted as hundreds of feet, matching AeroAPI examples, and stored as feet
- `last_position.update_type` -> source type

All raw flight records are retained in raw storage for later reprocessing.

## Validation status

A DEV manual call for Libya returned HTTP 200 and live records with `last_position` data. The provider remains marked `TESTING` until its country-level counts have been compared against FRP, PFP and SLP over a stable collection window.
