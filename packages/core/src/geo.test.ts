import { describe, expect, it } from "vitest";
import { isPointInBoundingBox } from "./index.js";

describe("isPointInBoundingBox", () => {
  it("tags a point inside Burundi's approximate bbox", () => {
    expect(isPointInBoundingBox(-3.4, 29.9, { north: -2.3, south: -4.5, east: 30.9, west: 28.9 })).toBe(true);
  });

  it("rejects a point outside the bbox", () => {
    expect(isPointInBoundingBox(1, 20, { north: -2.3, south: -4.5, east: 30.9, west: 28.9 })).toBe(false);
  });
});
