import { afterEach, describe, expect, it, vi } from "vitest";
import { mapSkyLinkAircraft, RapidSkyLinkProviderAdapter } from "./rapid-skylink.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RapidSkyLinkProviderAdapter mapping", () => {
  it("maps SkyLink aircraft records to normalized observations", () => {
    const record = mapSkyLinkAircraft({
      icao24: "0094D7",
      callsign: "LNK693D",
      latitude: -26.338511,
      longitude: 28.172695,
      altitude: 11075,
      ground_speed: 296,
      track: 196,
      vertical_rate: 2560,
      is_on_ground: false,
      last_seen: "2026-06-06T10:14:14.815018",
      first_seen: "2026-06-06T10:11:15.724305",
      registration: "ZS-YDA",
      aircraft_type: "Embraer E190",
      airline: "Airlink",
      photo_url: null
    });

    expect(record).toMatchObject({
      icao24: "0094D7",
      callsign: "LNK693D",
      registration: "ZS-YDA",
      aircraftTypeIcao: "Embraer E190",
      operatorName: "Airlink",
      latitude: -26.338511,
      longitude: 28.172695,
      altitudeFt: 11075,
      groundSpeedKt: 296,
      headingDeg: 196,
      verticalRateFpm: 2560,
      onGround: false,
      sourceType: "rapid-skylink"
    });
  });

  it("requests live aircraft with a server-side bounding box filter", async () => {
    vi.stubEnv("RAPIDAPI_KEY", "test-key");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          aircraft: [
            {
              icao24: "0101F6",
              callsign: "OYA220",
              latitude: 33.197563,
              longitude: 13.05798,
              last_seen: "2026-06-08T09:00:00"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RapidSkyLinkProviderAdapter();
    const result = await adapter.fetchLivePositions({
      bbox: { south: 19.5, west: 9.3, north: 33.3, east: 25.2 }
    });

    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const requestedUrl = new URL(String(firstCall?.[0]));
    expect(requestedUrl.pathname).toBe("/adsb/aircraft");
    expect(requestedUrl.searchParams.get("photos")).toBe("false");
    expect(requestedUrl.searchParams.get("bbox")).toBe("19.5,9.3,33.3,25.2");
    expect(requestedUrl.searchParams.has("offset")).toBe(false);
    expect(result.requestParams).toMatchObject({
      bbox: "19.5,9.3,33.3,25.2",
      serverSideBboxFilter: true
    });
    expect(result.records).toHaveLength(1);
  });
});
