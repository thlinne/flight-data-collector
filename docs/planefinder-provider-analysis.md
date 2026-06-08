# Plane Finder API analysis

Date: 2026-06-08

## Stored reference PDFs

The source screenshots from the Plane Finder API site have been archived here:

- `docs/provider-references/planefinder-api-docs-2026-06-08.pdf`
- `docs/provider-references/planefinder-api-pricing-2026-06-08.pdf`

Official online references used:

- https://api.planefinder.net/docs/getting-started
- https://api.planefinder.net/docs/api-overview
- https://api.planefinder.net/docs/live-data
- https://api.planefinder.net/docs/historic-data
- https://api.planefinder.net/pricing

## Fit for Flight Data Collector

Plane Finder is a strong candidate for provider 4 because its API matches our current comparison model:

- Live aircraft positions can be queried by bounding box.
- Historical aircraft positions can use the same geographic filters.
- Responses contain normalized aviation fields that map well to our raw observation model: `adshex`, `reg`, `callsign`, `type`, `lat`, `lon`, `altitude`, `heading`, `speed`, `departureAirport`, `arrivalAirport`, `flightNumber`, `dataSource`, `class`, `operatorICAO`, `lastSeen`.
- Authentication is direct Bearer-token auth, not RapidAPI.

## Recommended plan

Start with `PF Growth`.

Reasons:

- Published price: USD 140 per month.
- Monthly credits: 400,000.
- Rate limit: 15 requests per minute.
- Response limit: up to 1,000 aircraft per position request.
- Historic access: 2 years.
- Live and historic position requests cost 10 credits each.

This is the lowest plan that looks realistic for our 10-country comparison. `PF Starter` only returns up to 100 aircraft per request and gives only 30 days historic access, which is too small for our use case.

## Live endpoint for v1 integration

Use the standard live endpoint first:

```http
GET https://api.planefinder.net/api/v1/live/aircraft
Authorization: Bearer <PLANE_FINDER_API_KEY>
```

With country BBOX parameters:

```text
min_lat=<south>
max_lat=<north>
min_lon=<west>
max_lon=<east>
per_page=1000
```

Do not use the extended endpoint initially. It costs 20 credits instead of 10 and gives avionics details that are not needed for the first provider-quality comparison.

## Pagination

Plane Finder may return cursor pagination. For each provider-country fetch:

1. Request first page with BBOX and `per_page=1000`.
2. Store the full raw response.
3. If `meta.next_cursor` exists, request the next page with the same filters plus `cursor`.
4. Create one `ProviderFetchRun` for the country/provider run and link all raw responses to it.

Each page costs another 10 credits, so pagination must be counted in provider cost tracking.

## Cost estimate

Naive country polling every 10 minutes:

```text
10 countries * 144 polls/day * 30 days * 10 credits = 432,000 credits/month
```

This is slightly above the PF Growth allowance of 400,000 credits before pagination. Therefore the first DEV test should run at 10 minutes, but production polling should be watched closely.

Possible optimizations:

- Use larger regional BBOX groups where response size remains under 1,000 aircraft.
- Poll lower-volume countries less often.
- Reduce Plane Finder to 15-minute or 20-minute intervals if quality is good but credits are tight.
- Prefer the standard endpoint over extended.
- Add hard credit budgets in `ProviderCountryConfig`.

## Historic data options

Plane Finder has three historic endpoint patterns:

```http
GET /v1/historic/aircraft/{timestamp}
GET /v1/historic/flights
GET /v1/historic/flight/{flightId}
```

For our 10 countries, the most useful endpoint is:

```http
GET https://api.planefinder.net/api/v1/historic/aircraft/{timestamp}
```

It accepts the same filters as live aircraft positions, including BBOX. This makes it suitable for country-level backfill and provider benchmarking.

Use cases:

- Reconstruct "what aircraft were visible over country X at time Y".
- Sample country activity every N minutes for historical baseline analysis.
- Compare historical Plane Finder counts with Flight Radar / ADSBexchange / SkyLink for the same country and time window.

Less useful for first backfill:

- `GET /v1/historic/flights` requires identifiers such as ICAO hex, registration, callsign, or flight number. It is useful after we already know a flight or aircraft.
- `GET /v1/historic/flight/{flightId}` is useful for detailed track reconstruction after a flight has been identified.

## Historic cost implications

Historic aircraft positions cost 10 credits per request. A one-day 10-country backfill sampled every 10 minutes would cost:

```text
10 countries * 144 timestamps * 10 credits = 14,400 credits/day
```

A 30-day backfill at that density would cost:

```text
14,400 * 30 = 432,000 credits
```

That already exceeds PF Growth monthly credits, so historical backfills must be deliberate jobs with explicit credit budgets.

Recommended historical strategy:

1. Start with one country and one day.
2. Sample every 10 minutes.
3. Compare against live provider observations and known traffic expectations.
4. Increase density only where the result materially improves flight reconstruction.

## Implementation proposal

Add a new provider adapter:

```text
packages/providers/src/plane-finder.ts
```

Environment variable:

```text
PLANE_FINDER_API_KEY=
```

Provider code:

```text
PLANE_FINDER
```

Provider display name:

```text
Plane Finder API
```

Initial config:

- enabled in DEV only
- live enabled for all 10 countries
- polling interval: 600 seconds
- max requests/hour: conservative initial value, then tune from usage
- standard live endpoint only
- no extended endpoint
- no historical backfill until manual approval

## Raw data handling

Keep all Plane Finder responses in the raw layer first. Normalize into `RawFlightObservation` separately. Do not deduplicate across providers at ingest time.

Within one Plane Finder provider-country run, deduplicate same aircraft/page overlaps by:

- provider
- country
- `adshex`
- `lastSeen`

Across providers, do not deduplicate in the raw layer. Provider quality comparison requires the original data to remain separate.

## Open questions before implementation

- Confirm the exact API key naming convention in `.env`.
- Confirm whether PF Growth is active and whether the account page exposes current credit usage.
- Confirm whether we want Plane Finder initially on DEV only or also seeded inactive for PROD.
