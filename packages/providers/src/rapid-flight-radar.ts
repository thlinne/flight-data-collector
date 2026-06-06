import type { BoundingBox, ProviderFetchResult, ProviderNormalizedRecord } from "@flight-data-collector/core";
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
    if (value === "1" || value.toLowerCase() === "true") return true;
    if (value === "0" || value.toLowerCase() === "false") return false;
  }
  return null;
}

function pick(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function extractRecordCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as UnknownRecord;

  for (const key of ["flightsList", "data", "flights", "aircraft", "result", "results"]) {
    const value = object[key];
    if (Array.isArray(value)) return value;
  }

  return Object.entries(object)
    .filter(([key, value]) => !["full_count", "version", "stats"].includes(key) && (Array.isArray(value) || typeof value === "object"))
    .map(([flightId, value]) => {
      if (Array.isArray(value)) return { flightId, fr24Array: value };
      return { flightId, ...(value as UnknownRecord) };
    });
}

function mapArrayRecord(record: UnknownRecord): ProviderNormalizedRecord | null {
  const values = Array.isArray(record.fr24Array) ? record.fr24Array : null;
  if (!values) return null;

  const latitude = valueAsNumber(values[1]);
  const longitude = valueAsNumber(values[2]);
  if (latitude == null || longitude == null) return null;

  const timestamp = valueAsNumber(values[10]);
  return {
    observedAt: timestamp ? new Date(timestamp * 1000) : new Date(),
    providerAircraftId: valueAsString(values[0]),
    providerFlightId: valueAsString(record.flightId),
    icao24: valueAsString(values[0]),
    callsign: valueAsString(values[16]) ?? valueAsString(values[13]),
    registration: valueAsString(values[9]),
    aircraftTypeIcao: valueAsString(values[8]),
    operatorName: null,
    airlineIcao: null,
    airlineIata: null,
    originAirportIcao: valueAsString(values[11]),
    destinationAirportIcao: valueAsString(values[12]),
    latitude,
    longitude,
    altitudeFt: valueAsNumber(values[4]),
    groundSpeedKt: valueAsNumber(values[5]),
    headingDeg: valueAsNumber(values[3]),
    verticalRateFpm: valueAsNumber(values[15]),
    squawk: valueAsString(values[6]),
    onGround: valueAsBoolean(values[14]),
    sourceType: "rapid-flight-radar",
    rawRecord: record
  };
}

function mapObjectRecord(input: unknown): ProviderNormalizedRecord | null {
  if (!input || typeof input !== "object") return null;
  const record = input as UnknownRecord;
  const arrayMapped = mapArrayRecord(record);
  if (arrayMapped) return arrayMapped;

  const latitude = valueAsNumber(pick(record, ["lat", "latitude"]));
  const longitude = valueAsNumber(pick(record, ["lon", "lng", "longitude"]));
  if (latitude == null || longitude == null) return null;

  const observedValue = pick(record, ["timestampMs", "timestamp", "time", "lastSeen", "updated", "seen"]);
  const observedAt =
    typeof observedValue === "number"
      ? new Date(observedValue > 9_999_999_999 ? observedValue : observedValue * 1000)
      : valueAsString(observedValue)
        ? new Date(valueAsString(observedValue) as string)
        : new Date();

  return {
    observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
    providerAircraftId: valueAsString(pick(record, ["aircraftId", "aircraft_id", "id", "hex", "flightid"])),
    providerFlightId: valueAsString(pick(record, ["flightId", "flight_id", "flightid", "fr24_id", "id"])),
    icao24: valueAsString(pick(record, ["icao24", "hex", "modeS", "mode_s"])),
    callsign: valueAsString(pick(record, ["callsign", "flight", "ident"])),
    registration: valueAsString(pick(record, ["registration", "reg"])),
    aircraftTypeIcao: valueAsString(pick(record, ["aircraftTypeIcao", "type", "aircraft_code", "icon"])),
    operatorName: valueAsString(pick(record, ["operator", "airlineName", "airline_name"])),
    airlineIcao: valueAsString(pick(record, ["airlineIcao", "airline_icao"])),
    airlineIata: valueAsString(pick(record, ["airlineIata", "airline_iata"])),
    originAirportIcao: valueAsString(pick(record, ["originAirportIcao", "origin", "from"])),
    destinationAirportIcao: valueAsString(pick(record, ["destinationAirportIcao", "destination", "to"])),
    latitude,
    longitude,
    altitudeFt: valueAsNumber(pick(record, ["altitudeFt", "altitude", "alt"])),
    groundSpeedKt: valueAsNumber(pick(record, ["groundSpeedKt", "speed", "gs"])),
    headingDeg: valueAsNumber(pick(record, ["headingDeg", "heading", "track"])),
    verticalRateFpm: valueAsNumber(pick(record, ["verticalRateFpm", "verticalSpeed", "vspeed"])),
    squawk: valueAsString(pick(record, ["squawk"])),
    onGround: valueAsBoolean(pick(record, ["onGround", "ground"])),
    sourceType: "rapid-flight-radar",
    rawRecord: record
  };
}

export class RapidFlightRadarProviderAdapter implements FlightDataProviderAdapter {
  code = "RAPID_FLIGHT_RADAR";
  displayName = "RapidAPI Flight Radar";
  supportsLive = true;
  supportsHistorical = false;
  private defaultDataSource = "ADSB,MLAT,FLARM,FAA,SATELLITE,UAT,SPIDERTRACKS,AUS,OTHER_DATA_SOURCE,ESTIMATED";
  private defaultService =
    "PASSENGER,CARGO,MILITARY_AND_GOVERNMENT,BUSINESS_JETS,GENERAL_AVIATION,HELICOPTERS,LIGHTER_THAN_AIR,DRONES,OTHER_SERVICE,NON_CATEGORIZED,GLIDERS,GROUND_VEHICLES";

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number }): Promise<ProviderFetchResult> {
    const apiKey = process.env.RAPIDAPI_KEY;
    const host = process.env.RAPID_FLIGHT_RADAR_HOST ?? "flight-radar1.p.rapidapi.com";
    const endpoint = process.env.RAPID_FLIGHT_RADAR_LIVE_ENDPOINT ?? "/flights/v2/list-in-boundary";

    if (!apiKey) {
      throw new Error("RAPIDAPI_KEY is not configured.");
    }

    const url = new URL(`https://${host}${endpoint}`);
    url.searchParams.set("south", String(input.bbox.south));
    url.searchParams.set("west", String(input.bbox.west));
    url.searchParams.set("north", String(input.bbox.north));
    url.searchParams.set("east", String(input.bbox.east));
    url.searchParams.set("limit", String(input.limit ?? 300));
    url.searchParams.set("dataSource", this.defaultDataSource);
    url.searchParams.set("service", this.defaultService);
    url.searchParams.set("trafficType", "ALL");
    url.searchParams.set("stats", "true");

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
      throw new Error(
        `RapidAPI Flight Radar request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(rawPayload)}`
      );
    }

    if (!responseText.trim()) {
      throw new Error(`RapidAPI Flight Radar returned HTTP ${response.status} with an empty response body.`);
    }

    const records = extractRecordCandidates(rawPayload)
      .map(mapObjectRecord)
      .filter((record): record is ProviderNormalizedRecord => Boolean(record));

    return {
      providerCode: this.code,
      endpoint: url.origin + url.pathname,
      requestParams: {
        south: input.bbox.south,
        west: input.bbox.west,
        north: input.bbox.north,
        east: input.bbox.east,
        limit: input.limit ?? 300,
        dataSource: this.defaultDataSource,
        service: this.defaultService,
        trafficType: "ALL",
        stats: true
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
    throw new Error("RapidAPI Flight Radar historical positions are not implemented for v1.");
  }
}
