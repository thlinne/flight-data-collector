import { z } from "zod";

export const boundingBoxSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number()
});

export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export type ProviderPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface ProviderNormalizedRecord {
  observedAt: Date;
  providerAircraftId?: string | null;
  providerFlightId?: string | null;
  icao24?: string | null;
  callsign?: string | null;
  registration?: string | null;
  aircraftTypeIcao?: string | null;
  operatorName?: string | null;
  airlineIcao?: string | null;
  airlineIata?: string | null;
  originAirportIcao?: string | null;
  destinationAirportIcao?: string | null;
  latitude: number;
  longitude: number;
  altitudeFt?: number | null;
  groundSpeedKt?: number | null;
  headingDeg?: number | null;
  verticalRateFpm?: number | null;
  squawk?: string | null;
  onGround?: boolean | null;
  sourceType?: string | null;
  rawRecord: unknown;
}

export interface ProviderFetchResult {
  providerCode: string;
  endpoint: string;
  requestParams: Record<string, unknown>;
  receivedAt: Date;
  rawPayload: unknown;
  records: ProviderNormalizedRecord[];
  nextCursor?: string;
  rateLimitInfo?: {
    remaining?: number;
    resetAt?: Date;
    costCredits?: number;
  };
}

export function nowUtc(): Date {
  return new Date();
}

export function isPointInBoundingBox(latitude: number, longitude: number, bbox: BoundingBox): boolean {
  return latitude <= bbox.north && latitude >= bbox.south && longitude <= bbox.east && longitude >= bbox.west;
}

export function normalizeCallsign(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}
