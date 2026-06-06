import { describe, expect, it } from "vitest";
import { mapAdsbExchangeAircraft } from "./rapid-adsbexchange.js";

describe("RapidAdsbExchangeProviderAdapter mapping", () => {
  it("maps ADSBexchange aircraft records to normalized observations", () => {
    const record = mapAdsbExchangeAircraft(
      {
        hex: "406c39",
        type: "adsb_icao",
        flight: "VIR359  ",
        r: "G-VWHO",
        t: "B789",
        alt_baro: 9025,
        gs: 250.7,
        track: 263.36,
        baro_rate: -576,
        squawk: "3101",
        lat: 51.651569,
        lon: 0.228195,
        seen: 0.1
      },
      1_780_735_644_753
    );

    expect(record).toMatchObject({
      icao24: "406c39",
      callsign: "VIR359",
      registration: "G-VWHO",
      aircraftTypeIcao: "B789",
      latitude: 51.651569,
      longitude: 0.228195,
      altitudeFt: 9025,
      groundSpeedKt: 250.7,
      headingDeg: 263.36,
      verticalRateFpm: -576,
      squawk: "3101",
      sourceType: "adsb_icao"
    });
  });

  it("treats ground altitude as on-ground", () => {
    const record = mapAdsbExchangeAircraft(
      {
        hex: "502dbc",
        flight: "UAG97Y  ",
        alt_baro: "ground",
        lat: 51.322403,
        lon: 0.030751
      },
      1_780_735_644_753
    );

    expect(record?.altitudeFt).toBe(0);
    expect(record?.onGround).toBe(true);
  });
});
