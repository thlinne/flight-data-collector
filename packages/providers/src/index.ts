export type { FlightDataProviderAdapter } from "./types.js";
export { PlaneFinderProviderAdapter } from "./plane-finder.js";
export { FlightAwareAeroProviderAdapter } from "./flightaware-aero.js";
export { RapidFlightRadarProviderAdapter } from "./rapid-flight-radar.js";
export { RapidAdsbExchangeProviderAdapter } from "./rapid-adsbexchange.js";
export { RapidSkyLinkProviderAdapter } from "./rapid-skylink.js";

import { FlightAwareAeroProviderAdapter } from "./flightaware-aero.js";
import { PlaneFinderProviderAdapter } from "./plane-finder.js";
import { RapidAdsbExchangeProviderAdapter } from "./rapid-adsbexchange.js";
import { RapidFlightRadarProviderAdapter } from "./rapid-flight-radar.js";
import { RapidSkyLinkProviderAdapter } from "./rapid-skylink.js";
import type { FlightDataProviderAdapter } from "./types.js";

export function createProviderAdapters(): Map<string, FlightDataProviderAdapter> {
  const adapters = [
    new RapidFlightRadarProviderAdapter(),
    new RapidAdsbExchangeProviderAdapter(),
    new RapidSkyLinkProviderAdapter(),
    new PlaneFinderProviderAdapter(),
    new FlightAwareAeroProviderAdapter()
  ];
  return new Map(adapters.map((adapter) => [adapter.code, adapter]));
}
