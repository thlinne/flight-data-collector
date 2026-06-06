import type { BoundingBox, ProviderFetchResult, ProviderNormalizedRecord } from "@flight-data-collector/core";
import type { FlightDataProviderAdapter } from "./types.js";

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class MockProviderAdapter implements FlightDataProviderAdapter {
  code = "MOCK";
  displayName = "Mock Provider";
  supportsLive = true;
  supportsHistorical = true;

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number; livePoint?: { latitude: number; longitude: number; radiusNm: number } }): Promise<ProviderFetchResult> {
    const count = input.limit ?? 8;
    const records = this.makeRecords(input.bbox, count, new Date());
    return {
      providerCode: this.code,
      endpoint: "mock://live",
      requestParams: { bbox: input.bbox, since: input.since?.toISOString(), limit: input.limit },
      receivedAt: new Date(),
      rawPayload: { provider: this.code, mode: "LIVE", records: records.map((record) => record.rawRecord) },
      records,
      rateLimitInfo: { remaining: 9999, costCredits: 0 }
    };
  }

  async fetchHistoricalPositions(input: {
    bbox: BoundingBox;
    from: Date;
    to: Date;
    limit?: number;
    cursor?: string;
  }): Promise<ProviderFetchResult> {
    const records = this.makeRecords(input.bbox, input.limit ?? 20, input.from);
    return {
      providerCode: this.code,
      endpoint: "mock://historical",
      requestParams: {
        bbox: input.bbox,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        limit: input.limit,
        cursor: input.cursor
      },
      receivedAt: new Date(),
      rawPayload: { provider: this.code, mode: "HISTORICAL", records: records.map((record) => record.rawRecord) },
      records
    };
  }

  private makeRecords(bbox: BoundingBox, count: number, observedAt: Date): ProviderNormalizedRecord[] {
    return Array.from({ length: count }, (_, index) => {
      const icao24 = `MOCK${String(index).padStart(2, "0")}`;
      return {
        observedAt,
        providerAircraftId: `mock-aircraft-${index}`,
        providerFlightId: `mock-flight-${Date.now()}-${index}`,
        icao24,
        callsign: `MCK${100 + index}`,
        registration: `M-${icao24}`,
        aircraftTypeIcao: "A320",
        operatorName: "Mock Airways",
        airlineIcao: "MCK",
        airlineIata: "MK",
        originAirportIcao: "HBBA",
        destinationAirportIcao: "HBBE",
        latitude: Number(randomBetween(bbox.south, bbox.north).toFixed(6)),
        longitude: Number(randomBetween(bbox.west, bbox.east).toFixed(6)),
        altitudeFt: 28000 + index * 100,
        groundSpeedKt: 420,
        headingDeg: 90,
        verticalRateFpm: 0,
        squawk: "2000",
        onGround: false,
        sourceType: "mock",
        rawRecord: { id: index, icao24, generatedAt: new Date().toISOString() }
      };
    });
  }
}
