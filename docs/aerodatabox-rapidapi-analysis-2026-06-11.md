# AeroDataBox (ADB) RapidAPI — Analyse & R2-Nutzung

Datum: 2026-06-11
Screenshot: `screencapture-rapidapi-aedbx-aedbx-api-aerodatabox-2026-06-11-15_16_17.pdf`
Abonnement: **Ultra** ($32/Monat) aktiv.

## Zweck im Projekt

ADB ist die **Zwischendatenquelle**, die die R2-Anreicherungslücke schließt: aus einem
FRP-Identifier (callsign → Flugnummer) liefert ADB **Start-/Zielflughafen, Plan-/
Prognosezeiten, Airline, Flugzeugmodell und Status**. Damit ersetzt ADB Google Flights als
R2-Anreicherung (siehe `docs/r2-frp-google-flights-enrichment-bridge-2026-06-11.md`).

## Plan / Konditionen (laut Screenshot)

| Stufe | Preis | Hinweis |
| --- | --- | --- |
| BASIC | $0.00/mo | |
| PRO | $5.35/mo | |
| **ULTRA (aktiv)** | **$32.00/mo** | unsere Stufe |
| MEGA | $160.00/mo | |

- Creator: AeDBX · Kategorie Travel · ~198 ms Latenz · 100 % Service-Level, 100 % Uptime
  (7/30 Tage). „API calls are not priced equally" — Endpunkte kosten unterschiedlich.
- Antwortformate: JSON (default), XML.

## Relevante Endpunkt-Gruppen (Screenshot)

- **Flights API** — FIDS & Schedules; **Flight Status (single day)** „found by flight number,
  ATC call-sign, aircraft registration, or 24-bit ICAO Mode-S address"; Flight History &
  Schedule (range); Flight Departure/Arrival Dates; Search Flight Numbers by Term.
- **Aircraft API** — Get aircraft (by tail/registration/Mode-S), Aircraft Registrations,
  Airline Fleet, Aircraft Photo, Search tail numbers.
- **Airport API** — Get Airport (by IATA/ICAO), Runways, Closest Airports, Free-text search.
- Industry/Statistical/Miscellaneous — FAA LADD, Delays, Distance/Flight-Time, Countries.

## Live verifizierte Endpunkte (Host `aerodatabox.p.rapidapi.com`, mit unserem Key)

| Aufruf | Ergebnis |
| --- | --- |
| `GET /flights/number/{number}/{date}` | **200**, Array von Flügen (siehe Format unten) |
| `GET /flights/callsign/{callsign}/{date}` | **204** (kein Treffer für ETH877) → Flugnummer ist der zuverlässigere Key |

Folgerung: **Lookup-Reihenfolge callsign → Flugnummer** (callsign zuerst, da FRP ihn immer
hat; Fallback auf abgeleitete IATA-Flugnummer via `OpenFlightsAirline` ICAO→IATA, weil der
callsign-Endpunkt oft leer ist).

## Antwortformat `/flights/number/{number}/{date}` (verifiziert)

Array (mehrere Legs/Tage möglich → bestes Element wählen):

```json
{
  "departure": { "airport": { "icao": "HAAB", "iata": "ADD", "name": "Addis Ababa Bole",
      "municipalityName": "Addis Ababa", "countryCode": "ET", "timeZone": "Africa/Addis_Ababa",
      "location": { "lat": 8.97789, "lon": 38.7993 } },
    "scheduledTime": { "utc": "2026-06-11 06:35Z", "local": "2026-06-11 09:35+03:00" },
    "terminal": "2", "quality": ["Basic"] },
  "arrival": { "airport": { "icao": "FWKI", "iata": "LLW", "name": "Lilongwe",
      "countryCode": "MW", "timeZone": "Africa/Blantyre" },
    "scheduledTime": { "utc": "2026-06-11 12:40Z" },
    "predictedTime": { "utc": "2026-06-11 10:26Z" }, "quality": ["Basic"] },
  "number": "ET 877", "status": "Unknown", "codeshareStatus": "Unknown", "isCargo": false,
  "aircraft": { "model": "Boeing 787-9" },
  "airline": { "name": "Ethiopian Airlines", "iata": "ET", "icao": "ETH" },
  "greatCircleDistance": { "km": 2578.18, "nm": 1392.1 },
  "lastUpdatedUtc": "2026-06-07 03:11Z"
}
```

Kandidatenauswahl: bevorzugt das Element, dessen `departure.scheduledTime.utc` auf das
Report-Datum (UTC) fällt; sonst erstes Element. `candidateCount` = Array-Länge (Ambiguität
sichtbar machen). Rohantwort wird gespeichert.

## Nutzung in R2 (Kurz)

- **Lookup-Key:** `callsign` (Pattern `^[A-Z]{3}\d{1,4}[A-Z]?$`) → ADB callsign; Fallback
  abgeleitete IATA-Flugnummer → ADB number.
- **Reuse/Cache:** Tabelle `AdbFlightLookup`, eindeutig pro `kind:value:datum`. Je
  Identität+Datum genau **eine** ADB-Abfrage, danach dauerhaft wiederverwendet (historische
  Tage ändern sich nicht).
- **Budget:** `AERODATABOX_MAX_REQUESTS_PER_REPORT` begrenzt Netz-Calls pro Report; Cache-
  Treffer zählen nicht.
- **Env:** `AERODATABOX_RAPIDAPI_HOST` (default `aerodatabox.p.rapidapi.com`),
  `AERODATABOX_RAPIDAPI_KEY` (Fallback `RAPIDAPI_KEY`), `AERODATABOX_MAX_REQUESTS_PER_REPORT`.

## Caveats

- Viele FRP-callsigns sind nicht-kommerziell (Militär/Gov/GA, Registrierungen) → kein
  ADB-Treffer; korrekt als `NO_QUERY_POSSIBLE`/`NO_MATCH` markieren, nicht als Fehler.
- ADB-Datenqualität ist als `quality: ["Basic"]` markiert; Zeiten können Plan- statt
  Ist-Werte sein. Für ANSP-Evidenz bleibt die beobachtete Position maßgeblich; ADB ist
  Anreicherung (Itinerary-Kontext), kein Positionsnachweis.
- „Single day" + mehrere Array-Elemente: Flugnummern können mehrere Legs/Tage liefern;
  Auswahl per Datum, Rohantwort bleibt erhalten.
