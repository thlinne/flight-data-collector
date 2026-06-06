import { describe, expect, it } from "vitest";
import { MockProviderAdapter } from "./mock.js";

describe("MockProviderAdapter", () => {
  it("maps mock records to normalized records inside the bbox", async () => {
    const adapter = new MockProviderAdapter();
    const result = await adapter.fetchLivePositions({
      bbox: { north: -2.3, south: -4.5, east: 30.9, west: 28.9 },
      limit: 3
    });
    expect(result.records).toHaveLength(3);
    expect(result.records[0]?.latitude).toBeGreaterThanOrEqual(-4.5);
    expect(result.records[0]?.longitude).toBeLessThanOrEqual(30.9);
  });
});
