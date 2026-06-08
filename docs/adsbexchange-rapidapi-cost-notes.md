# ADSBexchange RapidAPI Cost Notes

Date: 2026-06-07

This note records the current cost interpretation for ADSBexchange on RapidAPI and the resulting design decision for coverage-circle planning.

## Pricing model observed

Source:

- RapidAPI ADSBexchange pricing page: https://rapidapi.com/adsbx/api/adsbexchange-com1/pricing
- RapidAPI subscription pricing docs: https://docs.rapidapi.com/v2.0/docs/api-pricing

Current ADSBexchange plan observed:

| Item | Value |
| --- | --- |
| Plan | Basic |
| Monthly base price | USD 10.00 |
| Included requests | 10,000 requests/month |
| Request overage | USD 0.0015 per request over quota |
| Rate limit | No limit shown on pricing page |
| Included bandwidth | 10,240 MB/month |
| Bandwidth overage | USD 0.001 per MB over quota |

RapidAPI pricing docs state that paid/freemium plans can charge overages when the subscribed quota is exceeded. RapidAPI also exposes billing headers such as `X-RapidAPI-{{billing-object}}-limit` and `X-RapidAPI-{{billing-object}}-remaining`, depending on the billing object used by the API.

## Coverage plan comparison

Two ADSBexchange circle strategies were compared for the current 10-country BBOX planning set.

| Strategy | Requests per full 10-country sweep | Intended benefit | Cost implication |
| --- | ---: | --- | --- |
| Coarse radius plan | 47 | Fewer API requests, larger circles | Lower request cost, more overlap and duplicate retrieval |
| Hex overlap-reduction plan | 237 | Less gross over-coverage, less duplicate retrieval | Much higher request count |

At one full sweep per hour:

| Strategy | Requests/month estimate | Included requests | Billable overage requests | Approx. request cost including base plan |
| --- | ---: | ---: | ---: | ---: |
| Coarse radius plan | 33,840 | 10,000 | 23,840 | USD 45.76 |
| Hex overlap-reduction plan | 170,640 | 10,000 | 160,640 | USD 250.96 |

Formula:

```text
monthly_requests = requests_per_sweep * 24 * 30
request_cost = 10.00 + max(0, monthly_requests - 10000) * 0.0015
```

## Key conclusion

The hex overlap-reduction plan is geometrically cleaner, but it is not automatically cheaper.

For ADSBexchange on RapidAPI, the request quota is likely the dominant cost driver. The 237-request hex plan creates about five times as many requests as the 47-request coarse plan. To break even through bandwidth savings alone, the hex plan would need to save roughly:

```text
(237 - 47) * 0.0015 / 0.001 = 285 MB
```

of billable bandwidth per sweep. Based on the observed data volumes so far, that is unlikely.

## Decision for now

Do not enable the 237-request hex plan as the default production strategy.

Recommended approach:

1. Keep the coarse plan, or create a hybrid plan, as the production default.
2. Use the hex plan only for short, controlled tests.
3. Measure both plans before changing production defaults:
   - request count
   - response byte size
   - raw observation count
   - unique observation count
   - duplicate ratio
   - RapidAPI quota headers
4. Add internal cost guards before increasing ADSBexchange sweep frequency or request count.

## Implementation reminder

When implementing ADSBexchange cost tracking, store RapidAPI response headers per fetch run where available, especially:

- `X-RapidAPI-Requests-Limit`
- `X-RapidAPI-Requests-Remaining`
- any other `X-RapidAPI-*` billing/quota headers returned by the proxy

Also continue storing response byte size in `RawProviderResponse.byteSize`; this is needed to estimate bandwidth usage against the 10,240 MB/month included quota.
