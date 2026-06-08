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

function bboxCenter(bbox: BoundingBox): { latitude: number; longitude: number } {
  return {
    latitude: (bbox.north + bbox.south) / 2,
    longitude: (bbox.east + bbox.west) / 2
  };
}

function altitudeAsFeet(value: unknown): number | null {
  if (value === "ground") return 0;
  return valueAsNumber(value);
}

function observedAtFromNow(nowMs: number, seenSeconds: number | null): Date {
  if (seenSeconds == null) return new Date(nowMs);
  return new Date(nowMs - seenSeconds * 1000);
}

export function mapAdsbExchangeAircraft(record: unknown, nowMs: number): ProviderNormalizedRecord | null {
  if (!record || typeof record !== "object") return null;
  const aircraft = record as UnknownRecord;
  const latitude = valueAsNumber(aircraft.lat);
  const longitude = valueAsNumber(aircraft.lon);
  if (latitude == null || longitude == null) return null;

  const altBaro = aircraft.alt_baro;
  const seenSeconds = valueAsNumber(aircraft.seen);

  return {
    observedAt: observedAtFromNow(nowMs, seenSeconds),
    providerAircraftId: valueAsString(aircraft.hex),
    providerFlightId: null,
    icao24: valueAsString(aircraft.hex),
    callsign: valueAsString(aircraft.flight),
    registration: valueAsString(aircraft.r),
    aircraftTypeIcao: valueAsString(aircraft.t),
    operatorName: null,
    airlineIcao: null,
    airlineIata: null,
    originAirportIcao: null,
    destinationAirportIcao: null,
    latitude,
    longitude,
    altitudeFt: altitudeAsFeet(altBaro),
    groundSpeedKt: valueAsNumber(aircraft.gs),
    headingDeg: valueAsNumber(aircraft.track) ?? valueAsNumber(aircraft.true_heading),
    verticalRateFpm: valueAsNumber(aircraft.baro_rate) ?? valueAsNumber(aircraft.geom_rate),
    squawk: valueAsString(aircraft.squawk),
    onGround: altBaro === "ground" ? true : null,
    sourceType: valueAsString(aircraft.type) ?? "rapid-adsbexchange",
    rawRecord: aircraft
  };
}

function aircraftCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as UnknownRecord;
  return Array.isArray(object.ac) ? object.ac : [];
}

export class RapidAdsbExchangeProviderAdapter implements FlightDataProviderAdapter {
  code = "RAPID_ADSBEXCHANGE";
  displayName = "RapidAPI ADSBexchange";
  supportsLive = true;
  supportsHistorical = false;

  async fetchLivePositions(input: {
    bbox: BoundingBox;
    since?: Date;
    limit?: number;
    livePoint?: { latitude: number; longitude: number; radiusNm: number };
  }): Promise<ProviderFetchResult> {
    const apiKey = process.env.RAPIDAPI_KEY;
    const host = process.env.RAPID_ADSBEXCHANGE_HOST ?? "adsbexchange-com1.p.rapidapi.com";
    const defaultRadiusNm = Number(process.env.RAPID_ADSBEXCHANGE_RADIUS_NM ?? 20);
    const radiusNm = Number.isFinite(defaultRadiusNm) && defaultRadiusNm > 0 ? defaultRadiusNm : 20;

    if (!apiKey) {
      throw new Error("RAPIDAPI_KEY is not configured.");
    }

    const center = input.livePoint ?? { ...bboxCenter(input.bbox), radiusNm };
    const endpoint = `/v2/lat/${center.latitude.toFixed(5)}/lon/${center.longitude.toFixed(5)}/dist/${center.radiusNm}/`;
    const url = new URL(`https://${host}${endpoint}`);

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
      throw new Error(`RapidAPI ADSBexchange request failed with HTTP ${response.status} ${response.statusText}: ${JSON.stringify(rawPayload)}`);
    }

    if (!responseText.trim()) {
      throw new Error(`RapidAPI ADSBexchange returned HTTP ${response.status} with an empty response body.`);
    }

    const payloadObject = rawPayload && typeof rawPayload === "object" ? (rawPayload as UnknownRecord) : {};
    const nowMs = valueAsNumber(payloadObject.now) ?? Date.now();
    const records = aircraftCandidates(rawPayload)
      .map((aircraft) => mapAdsbExchangeAircraft(aircraft, nowMs))
      .filter((record): record is ProviderNormalizedRecord => Boolean(record));

    return {
      providerCode: this.code,
      endpoint: url.origin + url.pathname,
      requestParams: {
        latitude: center.latitude,
        longitude: center.longitude,
        radiusNm: center.radiusNm,
        bbox: input.bbox
      },
      httpStatus: response.status,
      responseByteSize: Buffer.byteLength(responseText),
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
    throw new Error("RapidAPI ADSBexchange historical positions are not implemented for v1.");
  }
}
