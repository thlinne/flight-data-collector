export type { FlightDataProviderAdapter } from "./types.js";
export { MockProviderAdapter } from "./mock.js";
export {
  AirNavRadarBoxProviderAdapter,
  FlightAwareProviderAdapter,
  Fr24ProviderAdapter,
  PlaneFinderProviderAdapter
} from "./official.js";
export { RapidFlightRadarProviderAdapter } from "./rapid-flight-radar.js";
export { RapidAdsbExchangeProviderAdapter } from "./rapid-adsbexchange.js";

import {
  AirNavRadarBoxProviderAdapter,
  FlightAwareProviderAdapter,
  Fr24ProviderAdapter,
  PlaneFinderProviderAdapter
} from "./official.js";
import { MockProviderAdapter } from "./mock.js";
import { RapidAdsbExchangeProviderAdapter } from "./rapid-adsbexchange.js";
import { RapidFlightRadarProviderAdapter } from "./rapid-flight-radar.js";
import type { FlightDataProviderAdapter } from "./types.js";

export function createProviderAdapters(): Map<string, FlightDataProviderAdapter> {
  const adapters = [
    new MockProviderAdapter(),
    new RapidFlightRadarProviderAdapter(),
    new RapidAdsbExchangeProviderAdapter(),
    new Fr24ProviderAdapter(),
    new PlaneFinderProviderAdapter(),
    new AirNavRadarBoxProviderAdapter(),
    new FlightAwareProviderAdapter()
  ];
  return new Map(adapters.map((adapter) => [adapter.code, adapter]));
}
