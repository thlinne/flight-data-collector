import type { BoundingBox, ProviderFetchResult } from "@flight-data-collector/core";
import type { FlightDataProviderAdapter } from "./types.js";

abstract class OfficialProviderAdapter implements FlightDataProviderAdapter {
  abstract code: string;
  abstract displayName: string;
  supportsLive = true;
  supportsHistorical = true;

  protected abstract apiKeyEnvName: string;

  async fetchLivePositions(input: { bbox: BoundingBox; since?: Date; limit?: number; livePoint?: { latitude: number; longitude: number; radiusNm: number } }): Promise<ProviderFetchResult> {
    return this.todoResult("LIVE", input);
  }

  async fetchHistoricalPositions(input: {
    bbox: BoundingBox;
    from: Date;
    to: Date;
    limit?: number;
    cursor?: string;
  }): Promise<ProviderFetchResult> {
    return this.todoResult("HISTORICAL", input);
  }

  private todoResult(mode: "LIVE" | "HISTORICAL", requestParams: Record<string, unknown>): ProviderFetchResult {
    const hasApiKey = Boolean(process.env[this.apiKeyEnvName]);
    return {
      providerCode: this.code,
      endpoint: `todo://${this.code.toLowerCase()}/${mode.toLowerCase()}`,
      requestParams: { ...requestParams, apiKeyLoaded: hasApiKey },
      receivedAt: new Date(),
      rawPayload: {
        todo: `Implement official ${this.displayName} ${mode.toLowerCase()} endpoint mapping after API documentation is available.`,
        apiKeyEnvName: this.apiKeyEnvName
      },
      records: []
    };
  }
}

export class Fr24ProviderAdapter extends OfficialProviderAdapter {
  code = "FR24";
  displayName = "Flightradar24";
  protected apiKeyEnvName = "FR24_API_KEY";
}

export class PlaneFinderProviderAdapter extends OfficialProviderAdapter {
  code = "PLANE_FINDER";
  displayName = "Plane Finder";
  protected apiKeyEnvName = "PLANE_FINDER_API_KEY";
}

export class AirNavRadarBoxProviderAdapter extends OfficialProviderAdapter {
  code = "AIRNAV_RADARBOX";
  displayName = "AirNav RadarBox";
  protected apiKeyEnvName = "AIRNAV_API_KEY";
}

export class FlightAwareProviderAdapter extends OfficialProviderAdapter {
  code = "FLIGHTAWARE";
  displayName = "FlightAware AeroAPI";
  protected apiKeyEnvName = "FLIGHTAWARE_API_KEY";
}
