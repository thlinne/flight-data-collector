# RapidAPI Google Flights Provider Analysis

Date: 2026-06-09

Source files archived in `docs/provider-references`:

- `rapidapi-google-flights-pro-overview-2026-06-09.pdf`
- `rapidapi-google-flights-playground-sample-2026-06-09.pdf`

## Provider Summary

RapidAPI provider:

- API name: Google Flights
- RapidAPI path shown in browser: `things4u/api4upro-api-google-flights4`
- API creator shown in RapidAPI: `api4uPro`
- Category: Travel
- Plan currently selected: Pro
- Monthly request quota: 35,000 requests/month
- Overage shown: USD 0.0009/request
- Rate limit shown: 5 requests/second
- Bandwidth allowance shown: 10,240 MB/month, then USD 0.001/MB

## Important Finding

This is not a live aircraft position provider.

It does not replace FRP, ADSBexchange, SkyLink, or Plane Finder as a source of observed aircraft positions.

It is a flight search and itinerary API. It returns possible passenger flight options, prices, airlines, airports, dates, times, segments, and booking-related tokens.

## Endpoints Visible in the RapidAPI Overview

The overview screenshot shows these endpoint groups:

General/reference:

- `GET /languages`
- `GET /locations`
- `GET /currencies`
- `GET /auto-complete`

Price calendar:

- `GET /price-calendar/for-roundtrip`
- `GET /price-calendar/for-one-way`

Flights:

- `GET /flights/search-roundtrip`
- `GET /flights/roundtrip-returning`
- `GET /flights/search-one-way`
- `GET /flights/get-booking-results`

Observed request parameter names for `GET /flights/search-one-way`:

- `departureId`
- `arrivalId`
- `departureDate`
- optional: `flightNumber`
- optional/context: `adults`, `currency`, `languageCode`, `countryCode`

Important implementation note: the endpoint rejected snake_case parameters such as `departure_id`, `arrival_id`, and `outbound_date` with validation errors. Use camelCase request parameters.

Candidate matching decision for R2:

- Treat `topFlights` and `otherFlights` as one candidate list.
- A Google Flights candidate is selected only if one of its segments contains the expected `airlineCode` and `flightNumber`.
- If the endpoint returns alternatives but none contains the expected flight segment, store the enrichment result as `NO_MATCH`.
- Do not use the first returned itinerary as a fallback match, because Google Flights returns broad route alternatives even when `flightNumber` is supplied.

Date grid:

- `GET /date-grid/for-roundtrip`
- `GET /date-grid/for-one-way`

Price graph:

- `GET /price-graph/for-roundtrip`
- `GET /price-graph/for-one-way`

## Sample Payload Shape From RapidAPI Playground

The playground screenshot for `GET /flights/search-one-way` shows a response with this structure:

```json
{
  "data": {
    "topFlights": [
      {
        "price": 645,
        "detailToken": "opaque-provider-token",
        "airlineCode": "multi",
        "airlineNames": ["Ethiopian", "Air Cote D'Ivoire"],
        "segments": [
          {
            "departureAirportCode": "JFK",
            "departureAirportName": "John F. Kennedy International Airport",
            "arrivalAirportName": "Felix Houphouet Boigny International Airport",
            "arrivalAirportCode": "ABJ",
            "durationMinutes": 575,
            "departureTime": "22:00",
            "arrivalTime": "11:35",
            "cabinClass": 1,
            "seatPitch": "32 in",
            "airlineIndex": [
              {
                "airlineCode": "HF",
                "flightNumber": "3513",
                "airlineName": "Air Cote D'Ivoire"
              }
            ],
            "aircraftType": null,
            "aircraftName": "Boeing 787",
            "overnight": false,
            "delayed": null,
            "departureDate": "2025-04-16",
            "arrivalDate": "2025-04-17",
            "airline": [
              {
                "airlineCode": "ET",
                "flightNumber": "513",
                "airlineName": "Ethiopian"
              }
            ],
            "flightId": 518769,
            "someFlag": 0
          }
        ],
        "departureAirportCode": "JFK",
        "departureDate": "2025-04-16",
        "departureTime": "22:00",
        "arrivalAirportCode": "LOS",
        "arrivalDate": "2025-04-17",
        "arrivalTime": "22:45",
        "duration": 1185,
        "stops": 1,
        "isCodeShare": false,
        "hasTransit": null,
        "transferAirports": null,
        "fareId": null,
        "metadata": null,
        "baggage": null,
        "airline": [
          {
            "airlineCode": "ET",
            "airlineName": "Ethiopian",
            "link": "https://www.ethiopianairlines.com/..."
          },
          {
            "airlineCode": "HF",
            "airlineName": "Air Cote D'Ivoire",
            "link": "https://www.aircotedivoire.com/..."
          }
        ],
        "isAvailable": false
      }
    ]
  }
}
```

The exact token and fields may vary by endpoint and query.

## Potential Use For R2

R2 needs detailed information for each observed flight:

- flight number
- airline/operator
- aircraft type
- connected flight plan
- origin/destination and route context

Google Flights can help only with the commercial itinerary layer:

- enrich observed callsigns/flight numbers with passenger flight options
- infer candidate origin/destination airport pairs for a flight number and date
- show scheduled departure/arrival times when the flight appears in search results
- provide aircraft marketing names such as `Boeing 787` or `Airbus A380`

It cannot provide:

- observed positions
- actual overflight path
- FIR/ANSP airspace entry/exit evidence
- cargo flights unless they are exposed through passenger-style Google Flights results
- non-commercial, military, private, ferry, or many regional operations
- a complete schedule database for all flight numbers

## Recommended Use

Do not call Google Flights for every raw observation.

Recommended architecture:

1. Keep R2 based on our own observed provider data.
2. Extract unique candidate flight identities per report day:
   - provider-separated callsign
   - flight number if available
   - airline prefix if parseable
   - first/last observed timestamp
   - observed country
3. Query Google Flights only as an enrichment step for selected candidate commercial flights.
4. Cache every query and response in a separate reference/enrichment table.
5. Never overwrite observed data with Google Flights data.
6. Display Google Flights data in R2 as `Candidate schedule information`, not as confirmed evidence.

## Cost Control Notes

The Pro plan has 35,000 requests/month.

At 5 requests/second, the technical rate limit is not the limiting factor for our use case. The monthly request quota is the limiting factor.

For R2, Google Flights should be used with strict caching:

- cache key should include endpoint, query parameters, flight number/date/origin/destination where applicable
- avoid repeated calls for the same flight/date
- batch report enrichment should have a hard maximum request count
- show unresolved flights rather than spending unlimited requests

## R2 Decision

Google Flights is useful for R2 as an optional schedule/itinerary enrichment source.

It is not sufficient as the primary source for R2. The primary source remains our provider-separated observed flight data from live tracking providers.

Recommended label in customer reports:

`Commercial itinerary candidate from Google Flights API`

Recommended disclaimer:

`Schedule and itinerary information is provided as enrichment and may not represent the actually operated flight unless independently matched to observed flight identity and date.`
