import { describe, expect, it } from "vitest";
import { mapSkyLinkAircraft } from "./rapid-skylink.js";

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
});
