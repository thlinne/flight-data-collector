import type { BoundingBox, ProviderFetchResult, ProviderNormalizedRecord } from "@flight-data-collector/core";
import { isPointInBoundingBox } from "@flight-data-collector/core";
import type { FlightDataProviderAdapter } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function valueAsString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueAsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueAsBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function valueAsDate(value: unknown): Date | null {
  const text = valueAsString(value);
  if (!text) return null;
  const date = new Date(text.endsWith("Z") ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapSkyLinkAircraft(record: unknown): ProviderNormalizedRecord | null {
  if (!record || typeof record !== "object") return null;
  const aircraft = record as UnknownRecord;
  const latitude = valueAsNumber(aircraft.latitude);
  const longitude = valueAsNumber(aircraft.longitude);
  if (latitude == null || longitude == null) return null;

  return {
    observedAt: valueAsDate(aircraft.last_seen) ?? new Date(),
    providerAircraftId: valueAsString(aircraft.icao24),
    providerFlightId: null,
    icao24: valueAsString(aircraft.icao24),
    callsign: valueAsString(aircraft.callsign),
    registration: valueAsString(aircraft.registration),
    aircraftTypeIcao: valueAsString(aircraft.aircraft_type),
    operatorName: valueAsString(aircraft.airline),
    airlineIcao: null,
    airlineIata: null,
    originAirportIcao: null,
    destinationAirportIcao: null,
    latitude,
    longitude,
    altitudeFt: valueAsNumber(aircraft.altitude),
    groundSpeedKt: valueAsNumber(aircraft.ground_speed),
    headingDeg: valueAsNumber(aircraft.track),
    verticalRateFpm: valueAsNumber(aircraft.vertical_rate),
    squawk: null,
    onGround: valueAsBoolean(aircraft.is_on_ground),
    sourceType: "rapid-skylink",
    rawRecord: aircraft
  };
}

function aircraftCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as UnknownRecord;
  return Array.isArray(object.aircraft) ? object.aircraft : [];
}

export class RapidSkyLinkProviderAdapter implements FlightDataProviderAdapter {
  code = "RAPID_SKYLINK";
  displayName = "RapidAPI SkyLink";
  supportsLive = true;
  supportsHistorical = false;

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number }): Promise<ProviderFetchResult> {
    const apiKey = process.env.RAPIDAPI_KEY;
    const host = process.env.RAPID_SKYLINK_HOST ?? "skylink-api.p.rapidapi.com";
    const endpoint = process.env.RAPID_SKYLINK_LIVE_ENDPOINT ?? "/adsb/aircraft";

    if (!apiKey) {
      throw new Error("RAPIDAPI_KEY is not configured.");
    }

    const url = new URL(`https://${host}${endpoint}`);
    url.searchParams.set("photos", "false");
    url.searchParams.set("bbox", `${input.bbox.south},${input.bbox.west},${input.bbox.north},${input.bbox.east}`);

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey
      }
    });

    const responseText = await response.text();
    let rawPayload: unknown = { emptyBody: true };
    if (responseText.trim()) {
      try {
        rawPayload = JSON.parse(responseText) as unknown;
      } catch {
        rawPayload = { nonJsonBody: responseText.slice(0, 1000) };
      }
    }

    if (!response.ok) {
      throw new Error(`RapidAPI SkyLink request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(rawPayload)}`);
    }

    if (!responseText.trim()) {
      throw new Error(`RapidAPI SkyLink returned HTTP ${response.status} with an empty response body.`);
    }

    const records = aircraftCandidates(rawPayload)
      .map(mapSkyLinkAircraft)
      .filter((record): record is ProviderNormalizedRecord => Boolean(record))
      .filter((record) => isPointInBoundingBox(record.latitude, record.longitude, input.bbox));

    return {
      providerCode: this.code,
      endpoint: url.origin + url.pathname,
      requestParams: {
        photos: false,
        bbox: `${input.bbox.south},${input.bbox.west},${input.bbox.north},${input.bbox.east}`,
        bboxObject: input.bbox,
        serverSideBboxFilter: true
      },
      receivedAt: new Date(),
      rawPayload,
      records,
      rateLimitInfo: {
        remaining: valueAsNumber(response.headers.get("x-ratelimit-requests-remaining")) ?? undefined,
        costCredits: valueAsNumber(response.headers.get("x-ratelimit-requests-cost")) ?? undefined
      }
    };
  }

  async fetchHistoricalPositions(): Promise<ProviderFetchResult> {
    throw new Error("RapidAPI SkyLink historical positions are backlogged for v1 live-data focus.");
  }
}
