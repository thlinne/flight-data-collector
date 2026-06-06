import { describe, expect, it } from "vitest";
import { RapidFlightRadarProviderAdapter } from "./rapid-flight-radar.js";

describe("RapidFlightRadarProviderAdapter", () => {
  it("can be constructed for registry use", () => {
    const adapter = new RapidFlightRadarProviderAdapter();
    expect(adapter.code).toBe("RAPID_FLIGHT_RADAR");
    expect(adapter.supportsLive).toBe(true);
  });
});
