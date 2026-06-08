# ADSBexchange Mixed Balanced Coverage Decision

Date: 2026-06-07

Status: implemented for DEV testing; production use requires explicit approval after validation.

## Decision

Use the ADSBexchange mixed balanced BBOX coverage plan for the current 10-country evaluation set.

The plan uses a mixture of 250 NM, 100 NM and 50 NM ADSBexchange radius requests. It is a compromise between:

- the previous coarse plan, which had the lowest request count but larger overlaps
- the uniform hex plan, which reduced gross overlap but increased request count too much

The mixed balanced plan uses 89 ADSBexchange requests per full 10-country sweep.

## Why Not The Uniform Hex Plan

The uniform hex plan is geometrically cleaner, but ADSBexchange on RapidAPI appears to be primarily request-count driven.

At one sweep per hour:

| Strategy | Requests / sweep | Estimated request cost / month |
| --- | ---: | ---: |
| Previous coarse plan | 47 | USD 45.76 |
| Mixed balanced plan | 89 | USD 91.12 |
| Uniform hex plan | 237 | USD 250.96 |

The mixed plan is more expensive than the coarse plan, but materially cheaper than the full hex plan while still reducing important over-coverage in large countries.

## Polling

For ADSBexchange, seeded provider-country configs use:

```text
livePollingIntervalSeconds = 600
```

This means one full country coverage sweep every 10 minutes for each enabled ADSBexchange provider-country configuration.

`maxRequestsPerHour` and `maxRequestsPerDay` are set from the number of ADSBexchange radius requests in each country plan:

```text
maxRequestsPerHour = country_radius_request_count * 6
maxRequestsPerDay = country_radius_request_count * 6 * 24
```

These values are budget metadata for dashboard/control purposes. Hard runtime enforcement should be added separately before aggressive production polling.

## Data Layer Rule

Raw provider data must remain complete.

The collector stores each ADSBexchange radius response as its own `RawProviderResponse`. Every normalized record from that response is stored in `RawFlightObservation`.

This intentionally means that overlapping ADSBexchange circles can create duplicate raw observations. That is correct for the raw evidence layer.

Deduplication belongs to a downstream normalized/analytics layer, not to the raw data layer. This preserves later auditability and allows us to compare provider quality and overlap effects.

## DEV First

The seed updates the ADSBexchange coverage areas and polling metadata so the mixed plan can be tested on DEV.

Production rollout should happen only after:

1. Visual review of the coverage maps.
2. A short DEV live test.
3. Measurement of request count, response bytes, raw observations, unique ICAO24 values and duplicate ratios.
4. Explicit approval to deploy and seed the same plan on PROD/ACE.

## Related Files

- `packages/db/prisma/seed.ts`
- `reports/adsbexchange-mixed-coverage-cost-comparison.md`
- `reports/adsbexchange-mixed-coverage-plan.html`
- `docs/adsbexchange-rapidapi-cost-notes.md`
