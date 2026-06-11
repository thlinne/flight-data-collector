import { describe, expect, it, vi } from "vitest";
import { FlightAwareAeroProviderAdapter, mapFlightAwareAeroFlight } from "./flightaware-aero.js";

describe("FlightAwareAeroProviderAdapter", () => {
  it("maps AeroAPI search flight records to normalized observations", () => {
    const mapped = mapFlightAwareAeroFlight({
      ident: "BRQ182",
      ident_icao: "BRQ182",
      ident_iata: "UZ182",
      fa_flight_id: "BRQ182-20260611-abc",
      registration: "OK-ABC",
      aircraft_type: "A320",
      origin: { code_icao: "GABS" },
      destination: { code_icao: "HLLT" },
      last_position: {
        fa_flight_id: "BRQ182-20260611-abc",
        altitude: 390,
        groundspeed: 457,
        heading: 1,
        latitude: 29.49815,
        longitude: 12.83241,
        timestamp: "2026-06-11T13:21:08Z",
        update_type: "A"
      }
    });

    expect(mapped).toMatchObject({
      providerAircraftId: "OK-ABC",
      providerFlightId: "BRQ182-20260611-abc",
      callsign: "BRQ182",
      registration: "OK-ABC",
      aircraftTypeIcao: "A320",
      originAirportIcao: "GABS",
      destinationAirportIcao: "HLLT",
      latitude: 29.49815,
      longitude: 12.83241,
      altitudeFt: 39000,
      groundSpeedKt: 457,
      headingDeg: 1,
      sourceType: "A"
    });
    expect(mapped?.observedAt.toISOString()).toBe("2026-06-11T13:21:08.000Z");
  });

  it("uses AeroAPI latlong query and x-apikey authentication", async () => {
    vi.stubEnv("FLIGHTAWARE_AERO_API_KEY", "test-key");
    vi.stubEnv("FLIGHTAWARE_AERO_MAX_PAGES_PER_FETCH", "1");
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/aeroapi/flights/search");
      expect(requestUrl.searchParams.get("query")).toBe('-latlong "19.5 9.3 33.3 25.2"');
      expect(requestUrl.searchParams.get("max_pages")).toBe("1");
      expect(init?.headers).toMatchObject({ "x-apikey": "test-key" });
      return new Response(
        JSON.stringify({
          flights: [
            {
              ident: "IVC7601",
              fa_flight_id: "IVC7601-20260611",
              aircraft_type: "E145",
              last_position: {
                altitude: 133,
                groundspeed: 1,
                heading: 0,
                latitude: 31.62498,
                longitude: 15.18261,
                timestamp: "2026-06-11T13:21:08Z",
                update_type: "A"
              }
            }
          ],
          links: { next: null }
        }),
        { status: 200, headers: { "x-ratelimit-remaining": "999" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FlightAwareAeroProviderAdapter();
    const result = await adapter.fetchLivePositions({ bbox: { north: 33.3, south: 19.5, east: 25.2, west: 9.3 } });

    expect(result.providerCode).toBe("FLIGHTAWARE_AERO");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.callsign).toBe("IVC7601");
    expect(result.rateLimitInfo?.remaining).toBe(999);
  });
});
