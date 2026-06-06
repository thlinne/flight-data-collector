import type { BoundingBox, ProviderFetchResult } from "@flight-data-collector/core";

export interface FlightDataProviderAdapter {
  code: string;
  displayName: string;
  supportsLive: boolean;
  supportsHistorical: boolean;
  fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number }): Promise<ProviderFetchResult>;
  fetchHistoricalPositions(input: {
    bbox: BoundingBox;
    from: Date;
    to: Date;
    limit?: number;
    cursor?: string;
  }): Promise<ProviderFetchResult>;
}
