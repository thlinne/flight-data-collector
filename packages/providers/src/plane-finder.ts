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
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true" || lowered === "1") return true;
    if (lowered === "false" || lowered === "0") return false;
  }
  return null;
}

function valueAsDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 9_999_999_999 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = valueAsString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pick(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

export function mapPlaneFinderAircraft(input: unknown, fallbackObservedAt = new Date()): ProviderNormalizedRecord | null {
  if (!input || typeof input !== "object") return null;
  const aircraft = input as UnknownRecord;
  const latitude = valueAsNumber(pick(aircraft, ["lat", "latitude"]));
  const longitude = valueAsNumber(pick(aircraft, ["lon", "lng", "longitude"]));
  if (latitude == null || longitude == null) return null;

  const observedAt = valueAsDate(pick(aircraft, ["lastSeen", "last_seen", "lastMovement", "timestamp"])) ?? fallbackObservedAt;

  return {
    observedAt,
    providerAircraftId: valueAsString(pick(aircraft, ["adshex", "icao24", "hex"])),
    providerFlightId: valueAsString(pick(aircraft, ["flightId", "flight_id"])),
    icao24: valueAsString(pick(aircraft, ["adshex", "icao24", "hex"])),
    callsign: valueAsString(aircraft.callsign),
    registration: valueAsString(pick(aircraft, ["reg", "registration"])),
    aircraftTypeIcao: valueAsString(pick(aircraft, ["type", "aircraftTypeIcao"])),
    operatorName: null,
    airlineIcao: valueAsString(aircraft.operatorICAO),
    airlineIata: null,
    originAirportIcao: valueAsString(aircraft.departureAirport),
    destinationAirportIcao: valueAsString(aircraft.arrivalAirport),
    latitude,
    longitude,
    altitudeFt: valueAsNumber(aircraft.altitude),
    groundSpeedKt: valueAsNumber(aircraft.speed),
    headingDeg: valueAsNumber(aircraft.heading),
    verticalRateFpm: valueAsNumber(aircraft.vertRate),
    squawk: valueAsString(aircraft.squawk),
    onGround: valueAsBoolean(aircraft.onGround),
    sourceType: valueAsString(aircraft.dataSource) ?? "plane-finder",
    rawRecord: aircraft
  };
}

function dataCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as UnknownRecord;
  return Array.isArray(object.data) ? object.data : [];
}

function nextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const object = payload as UnknownRecord;
  const meta = object.meta;
  if (!meta || typeof meta !== "object") return null;
  return valueAsString((meta as UnknownRecord).next_cursor);
}

export class PlaneFinderProviderAdapter implements FlightDataProviderAdapter {
  code = "PLANE_FINDER";
  displayName = "Plane Finder API";
  supportsLive = true;
  supportsHistorical = true;

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number }): Promise<ProviderFetchResult> {
    const apiKey = process.env.PLANE_FINDER_API_KEY;
    const baseUrl = process.env.PLANE_FINDER_BASE_URL ?? "https://api.planefinder.net/api";
    const endpoint = process.env.PLANE_FINDER_LIVE_ENDPOINT ?? "/v1/live/aircraft";
    const perPage = Math.min(Math.max(input.limit ?? Number(process.env.PLANE_FINDER_PER_PAGE ?? 1000), 1), 1000);
    const maxPages = Math.max(Number(process.env.PLANE_FINDER_MAX_PAGES_PER_FETCH ?? 3), 1);

    if (!apiKey) {
      throw new Error("PLANE_FINDER_API_KEY is not configured.");
    }

    const rawPages: unknown[] = [];
    const allRecords: ProviderNormalizedRecord[] = [];
    let cursor: string | null = null;
    let lastStatus: number | undefined;
    let totalByteSize = 0;
    let remaining: number | undefined;
    let resetAt: Date | undefined;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`${baseUrl}${endpoint}`);
      url.searchParams.set("min_lat", String(input.bbox.south));
      url.searchParams.set("max_lat", String(input.bbox.north));
      url.searchParams.set("min_lon", String(input.bbox.west));
      url.searchParams.set("max_lon", String(input.bbox.east));
      url.searchParams.set("per_page", String(perPage));
      if (cursor) url.searchParams.set("cursor", cursor);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      });

      const responseText = await response.text();
      lastStatus = response.status;
      totalByteSize += Buffer.byteLength(responseText, "utf8");
      remaining = valueAsNumber(response.headers.get("x-ratelimit-remaining")) ?? remaining;
      const retryAfter = valueAsNumber(response.headers.get("retry-after"));
      resetAt = retryAfter != null ? new Date(Date.now() + retryAfter * 1000) : resetAt;

      let rawPayload: unknown = { emptyBody: true };
      if (responseText.trim()) {
        try {
          rawPayload = JSON.parse(responseText) as unknown;
        } catch {
          rawPayload = { nonJsonBody: responseText.slice(0, 1000) };
        }
      }

      rawPages.push(rawPayload);

      if (!response.ok) {
        throw new Error(`Plane Finder request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(rawPayload)}`);
      }

      const records = dataCandidates(rawPayload)
        .map((record) => mapPlaneFinderAircraft(record))
        .filter((record): record is ProviderNormalizedRecord => Boolean(record))
        .filter((record) => isPointInBoundingBox(record.latitude, record.longitude, input.bbox));
      allRecords.push(...records);

      cursor = nextCursor(rawPayload);
      if (!cursor) break;
    }

    return {
      providerCode: this.code,
      endpoint: `${baseUrl}${endpoint}`,
      requestParams: {
        min_lat: input.bbox.south,
        max_lat: input.bbox.north,
        min_lon: input.bbox.west,
        max_lon: input.bbox.east,
        per_page: perPage,
        maxPages,
        serverSideBboxFilter: true
      },
      httpStatus: lastStatus,
      responseByteSize: totalByteSize,
      receivedAt: new Date(),
      rawPayload: rawPages.length === 1 ? rawPages[0] : { pages: rawPages },
      records: allRecords,
      nextCursor: cursor ?? undefined,
      rateLimitInfo: {
        remaining,
        resetAt,
        costCredits: rawPages.length * 10
      }
    };
  }

  async fetchHistoricalPositions(input: { bbox: BoundingBox; from: Date; to: Date; limit?: number; cursor?: string }): Promise<ProviderFetchResult> {
    const apiKey = process.env.PLANE_FINDER_API_KEY;
    const baseUrl = process.env.PLANE_FINDER_BASE_URL ?? "https://api.planefinder.net/api";
    const endpoint = process.env.PLANE_FINDER_HISTORIC_AIRCRAFT_ENDPOINT ?? "/v1/historic/aircraft";
    const perPage = Math.min(Math.max(input.limit ?? Number(process.env.PLANE_FINDER_PER_PAGE ?? 1000), 1), 1000);
    const maxPages = Math.max(Number(process.env.PLANE_FINDER_HISTORIC_MAX_PAGES_PER_FETCH ?? 1), 1);
    const snapshotAt = input.from;
    const timestamp = Math.floor(snapshotAt.getTime() / 1000);

    if (!apiKey) {
      throw new Error("PLANE_FINDER_API_KEY is not configured.");
    }

    const rawPages: unknown[] = [];
    const allRecords: ProviderNormalizedRecord[] = [];
    let cursor: string | null = input.cursor ?? null;
    let lastStatus: number | undefined;
    let totalByteSize = 0;
    let remaining: number | undefined;
    let resetAt: Date | undefined;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`${baseUrl}${endpoint}/${timestamp}`);
      url.searchParams.set("min_lat", String(input.bbox.south));
      url.searchParams.set("max_lat", String(input.bbox.north));
      url.searchParams.set("min_lon", String(input.bbox.west));
      url.searchParams.set("max_lon", String(input.bbox.east));
      url.searchParams.set("per_page", String(perPage));
      if (cursor) url.searchParams.set("cursor", cursor);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      });

      const responseText = await response.text();
      lastStatus = response.status;
      totalByteSize += Buffer.byteLength(responseText, "utf8");
      remaining = valueAsNumber(response.headers.get("x-ratelimit-remaining")) ?? remaining;
      const retryAfter = valueAsNumber(response.headers.get("retry-after"));
      resetAt = retryAfter != null ? new Date(Date.now() + retryAfter * 1000) : resetAt;

      let rawPayload: unknown = { emptyBody: true };
      if (responseText.trim()) {
        try {
          rawPayload = JSON.parse(responseText) as unknown;
        } catch {
          rawPayload = { nonJsonBody: responseText.slice(0, 1000) };
        }
      }

      rawPages.push(rawPayload);

      if (!response.ok) {
        throw new Error(`Plane Finder historical request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(rawPayload)}`);
      }

      const records = dataCandidates(rawPayload)
        .map((record) => mapPlaneFinderAircraft(record, snapshotAt))
        .filter((record): record is ProviderNormalizedRecord => Boolean(record))
        .filter((record) => isPointInBoundingBox(record.latitude, record.longitude, input.bbox));
      allRecords.push(...records);

      cursor = nextCursor(rawPayload);
      if (!cursor) break;
    }

    return {
      providerCode: this.code,
      endpoint: `${baseUrl}${endpoint}/${timestamp}`,
      requestParams: {
        timestamp,
        snapshotAt: snapshotAt.toISOString(),
        min_lat: input.bbox.south,
        max_lat: input.bbox.north,
        min_lon: input.bbox.west,
        max_lon: input.bbox.east,
        per_page: perPage,
        maxPages,
        serverSideBboxFilter: true,
        historicalSnapshot: true
      },
      httpStatus: lastStatus,
      responseByteSize: totalByteSize,
      receivedAt: new Date(),
      rawPayload: rawPages.length === 1 ? rawPages[0] : { pages: rawPages },
      records: allRecords,
      nextCursor: cursor ?? undefined,
      rateLimitInfo: {
        remaining,
        resetAt,
        costCredits: rawPages.length * 10
      }
    };
  }
}
