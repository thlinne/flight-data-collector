import { isPointInBoundingBox, type BoundingBox, type ProviderFetchResult, type ProviderNormalizedRecord } from "@flight-data-collector/core";
import type { FlightDataProviderAdapter } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function valueAsString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueAsIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function valueAsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asObject(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function pick(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function extractFlights(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const object = asObject(payload);
  if (!object) return [];

  for (const key of ["flights", "data", "results", "flight"]) {
    const value = object[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function airportIcao(value: unknown): string | null {
  const airport = asObject(value);
  if (!airport) return null;
  const code = valueAsString(pick(airport, ["code_icao", "icao", "code"]));
  return code && code.length === 4 ? code : null;
}

function dateFromValue(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 9_999_999_999 ? value : value * 1000);
  const text = valueAsString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextLink(payload: unknown): string | null {
  const object = asObject(payload);
  const links = asObject(object?.links);
  if (!links) return null;
  return valueAsString(pick(links, ["next", "next_url", "nextUrl"]));
}

export function mapFlightAwareAeroFlight(input: unknown): ProviderNormalizedRecord | null {
  const flight = asObject(input);
  if (!flight) return null;

  const position = asObject(flight.last_position) ?? flight;
  const latitude = valueAsNumber(pick(position, ["latitude", "lat"]));
  const longitude = valueAsNumber(pick(position, ["longitude", "lon", "lng"]));
  if (latitude == null || longitude == null) return null;

  const observedAt = dateFromValue(pick(position, ["timestamp", "last_seen", "lastSeen"])) ?? new Date();
  const altitudeHundreds = valueAsNumber(pick(position, ["altitude"]));

  return {
    observedAt,
    providerAircraftId: valueAsIdentifier(pick(flight, ["registration", "ident_icao", "ident", "fa_flight_id"])) ?? valueAsIdentifier(pick(position, ["fa_flight_id"])),
    providerFlightId: valueAsIdentifier(pick(flight, ["fa_flight_id"])) ?? valueAsIdentifier(pick(position, ["fa_flight_id"])),
    icao24: valueAsString(pick(flight, ["icao24", "hexid", "mode_s"])),
    callsign: valueAsString(pick(flight, ["ident_icao", "ident", "ident_iata"])),
    registration: valueAsString(pick(flight, ["registration"])),
    aircraftTypeIcao: valueAsString(pick(flight, ["aircraft_type", "aircraftType"])),
    operatorName: valueAsString(pick(flight, ["operator", "operator_name"])),
    airlineIcao: null,
    airlineIata: null,
    originAirportIcao: airportIcao(flight.origin),
    destinationAirportIcao: airportIcao(flight.destination),
    latitude,
    longitude,
    altitudeFt: altitudeHundreds == null ? null : altitudeHundreds * 100,
    groundSpeedKt: valueAsNumber(pick(position, ["groundspeed", "ground_speed", "speed"])),
    headingDeg: valueAsNumber(pick(position, ["heading", "track"])),
    verticalRateFpm: null,
    squawk: valueAsString(pick(position, ["squawk"])),
    onGround: altitudeHundreds === 0 ? true : null,
    sourceType: valueAsString(pick(position, ["update_type"])) ?? "flightaware-aeroapi",
    rawRecord: flight
  };
}

export class FlightAwareAeroProviderAdapter implements FlightDataProviderAdapter {
  code = "FLIGHTAWARE_AERO";
  displayName = "FlightAware AeroAPI";
  supportsLive = true;
  supportsHistorical = false;

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number }): Promise<ProviderFetchResult> {
    const apiKey = process.env.FLIGHTAWARE_AERO_API_KEY;
    const baseUrl = process.env.FLIGHTAWARE_AERO_BASE_URL ?? "https://aeroapi.flightaware.com/aeroapi";
    const endpoint = process.env.FLIGHTAWARE_AERO_SEARCH_ENDPOINT ?? "/flights/search";
    const maxPages = Math.max(1, Number(process.env.FLIGHTAWARE_AERO_MAX_PAGES_PER_FETCH ?? "1"));

    if (!apiKey) {
      throw new Error("FLIGHTAWARE_AERO_API_KEY is not configured.");
    }

    const allRecords: ProviderNormalizedRecord[] = [];
    let rawPayload: unknown = null;
    let responseByteSize = 0;
    let httpStatus: number | undefined;
    let rateLimitRemaining: number | undefined;
    let cursorUrl: string | null = null;

    for (let page = 0; page < maxPages; page += 1) {
      const url = cursorUrl ? new URL(cursorUrl, baseUrl) : new URL(`${baseUrl.replace(/\/$/, "")}${endpoint}`);
      if (!cursorUrl) {
        url.searchParams.set("query", `-latlong "${input.bbox.south} ${input.bbox.west} ${input.bbox.north} ${input.bbox.east}"`);
        url.searchParams.set("max_pages", "1");
      }

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "x-apikey": apiKey
        }
      });

      const responseText = await response.text();
      responseByteSize += Buffer.byteLength(responseText);
      httpStatus = response.status;
      rateLimitRemaining = valueAsNumber(response.headers.get("x-ratelimit-remaining")) ?? rateLimitRemaining;

      let pagePayload: unknown = { emptyBody: true };
      if (responseText.trim()) {
        try {
          pagePayload = JSON.parse(responseText) as unknown;
        } catch {
          pagePayload = { nonJsonBody: responseText.slice(0, 1000) };
        }
      }

      rawPayload = page === 0 ? pagePayload : { pages: [rawPayload, pagePayload] };

      if (!response.ok) {
        throw new Error(`FlightAware AeroAPI request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(pagePayload)}`);
      }

      const pageRecords = extractFlights(pagePayload)
        .map(mapFlightAwareAeroFlight)
        .filter((record): record is ProviderNormalizedRecord => Boolean(record))
        .filter((record) => isPointInBoundingBox(record.latitude, record.longitude, input.bbox));

      allRecords.push(...pageRecords);
      cursorUrl = nextLink(pagePayload);
      if (!cursorUrl) break;
    }

    return {
      providerCode: this.code,
      endpoint: `${baseUrl.replace(/\/$/, "")}${endpoint}`,
      requestParams: {
        query: `-latlong "${input.bbox.south} ${input.bbox.west} ${input.bbox.north} ${input.bbox.east}"`,
        maxPages,
        south: input.bbox.south,
        west: input.bbox.west,
        north: input.bbox.north,
        east: input.bbox.east
      },
      httpStatus,
      responseByteSize,
      receivedAt: new Date(),
      rawPayload,
      records: allRecords,
      rateLimitInfo: {
        remaining: rateLimitRemaining,
        costCredits: 1
      }
    };
  }

  async fetchHistoricalPositions(): Promise<ProviderFetchResult> {
    throw new Error("FlightAware AeroAPI historical positions are not implemented for v1.");
  }
}
