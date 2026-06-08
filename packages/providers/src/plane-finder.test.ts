import { describe, expect, it, vi } from "vitest";
import { mapPlaneFinderAircraft, PlaneFinderProviderAdapter } from "./plane-finder.js";

describe("PlaneFinderProviderAdapter mapping", () => {
  it("maps live aircraft records to normalized observations", () => {
    const mapped = mapPlaneFinderAircraft({
      adshex: "4005C1",
      reg: "G-RAES",
      callsign: "BAW183",
      type: "B772",
      lat: 54.436615,
      lon: -9.494045,
      altitude: 37975,
      heading: 291,
      speed: 457,
      squawk: "1417",
      vertRate: 256,
      departureAirport: "LHR",
      arrivalAirport: "JFK",
      flightNumber: "BA183",
      dataSource: "ADSB",
      class: "COMMERCIAL",
      operatorICAO: "BAW",
      blocked: false,
      lastSeen: 1773088473
    });

    expect(mapped).toMatchObject({
      providerAircraftId: "4005C1",
      icao24: "4005C1",
      callsign: "BAW183",
      registration: "G-RAES",
      aircraftTypeIcao: "B772",
      airlineIcao: "BAW",
      originAirportIcao: "LHR",
      destinationAirportIcao: "JFK",
      latitude: 54.436615,
      longitude: -9.494045,
      altitudeFt: 37975,
      groundSpeedKt: 457,
      headingDeg: 291,
      verticalRateFpm: 256,
      squawk: "1417",
      sourceType: "ADSB"
    });
  });

  it("uses BBOX query parameters and bearer authentication", async () => {
    vi.stubEnv("PLANE_FINDER_API_KEY", "test-key");
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v1/live/aircraft");
      expect(requestUrl.searchParams.get("min_lat")).toBe("19.5");
      expect(requestUrl.searchParams.get("max_lat")).toBe("33.3");
      expect(requestUrl.searchParams.get("min_lon")).toBe("9.3");
      expect(requestUrl.searchParams.get("max_lon")).toBe("25.2");
      expect(requestUrl.searchParams.get("per_page")).toBe("1000");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      return new Response(
        JSON.stringify({
          data: [{ adshex: "0101f6", callsign: "OYA220", lat: 33.197563, lon: 13.05798, lastSeen: 1780668660 }],
          meta: { next_cursor: null }
        }),
        { status: 200, headers: { "x-ratelimit-remaining": "123" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new PlaneFinderProviderAdapter();
    const result = await adapter.fetchLivePositions({ bbox: { north: 33.3, south: 19.5, east: 25.2, west: 9.3 } });

    expect(result.providerCode).toBe("PLANE_FINDER");
    expect(result.records).toHaveLength(1);
    expect(result.rateLimitInfo?.costCredits).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses historic aircraft endpoint with snapshot timestamp and BBOX filters", async () => {
    vi.stubEnv("PLANE_FINDER_API_KEY", "test-key");
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v1/historic/aircraft/1765800000");
      expect(requestUrl.searchParams.get("min_lat")).toBe("-4.5");
      expect(requestUrl.searchParams.get("max_lat")).toBe("-2.3");
      expect(requestUrl.searchParams.get("min_lon")).toBe("28.9");
      expect(requestUrl.searchParams.get("max_lon")).toBe("30.9");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      return new Response(
        JSON.stringify({
          data: [{ adshex: "04C001", callsign: "RWD123", lat: -3.3, lon: 29.3 }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new PlaneFinderProviderAdapter();
    const snapshotAt = new Date("2025-12-15T12:00:00Z");
    const result = await adapter.fetchHistoricalPositions({
      bbox: { north: -2.3, south: -4.5, east: 30.9, west: 28.9 },
      from: snapshotAt,
      to: snapshotAt
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.observedAt.toISOString()).toBe("2025-12-15T12:00:00.000Z");
    expect(result.requestParams).toMatchObject({ historicalSnapshot: true, snapshotAt: "2025-12-15T12:00:00.000Z" });
    expect(result.rateLimitInfo?.costCredits).toBe(10);
  });
});
