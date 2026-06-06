export interface DataCubeFilter {
  providerId?: string;
  countryId?: string;
  from?: Date;
  to?: Date;
}

export function providerOverlapReadinessMessage(): string {
  return "Provider overlap analytics is schema-ready and will be enabled after multiple real providers produce comparable live observations.";
}
