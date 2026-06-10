import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../..", ".env")];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (key === "APP_ENVIRONMENT" || key === "NEXT_PUBLIC_APP_ENVIRONMENT") {
      process.env[key] = value;
    } else {
      process.env[key] ??= value;
    }
  }
}

loadEnvFile();

const prisma = new PrismaClient();

const countries = [
  { iso2: "BI", iso3: "BDI", name: "Burundi", bbox: { north: -2.3, south: -4.5, east: 30.9, west: 28.9 }, priority: "CRITICAL" as const, primaryUseCase: "Primary coverage evaluation" },
  { iso2: "LY", iso3: "LBY", name: "Libya", bbox: { north: 33.3, south: 19.5, east: 25.2, west: 9.3 }, priority: "HIGH" as const },
  { iso2: "CD", iso3: "COD", name: "Democratic Republic of Congo", bbox: { north: 5.4, south: -13.5, east: 31.3, west: 12.2 }, priority: "HIGH" as const },
  { iso2: "MW", iso3: "MWI", name: "Malawi", bbox: { north: -9.3, south: -17.2, east: 35.9, west: 32.7 }, priority: "NORMAL" as const },
  { iso2: "ER", iso3: "ERI", name: "Eritrea", bbox: { north: 18.1, south: 12.4, east: 43.2, west: 36.4 }, priority: "NORMAL" as const },
  { iso2: "DJ", iso3: "DJI", name: "Djibouti", bbox: { north: 12.8, south: 10.9, east: 43.5, west: 41.7 }, priority: "NORMAL" as const },
  { iso2: "ML", iso3: "MLI", name: "Mali", bbox: { north: 25.0, south: 10.1, east: 4.3, west: -12.3 }, priority: "HIGH" as const },
  { iso2: "TD", iso3: "TCD", name: "Chad", bbox: { north: 23.5, south: 7.4, east: 24.0, west: 13.4 }, priority: "HIGH" as const },
  { iso2: "LS", iso3: "LSO", name: "Lesotho", bbox: { north: -28.5, south: -30.7, east: 29.5, west: 27.0 }, priority: "NORMAL" as const },
  { iso2: "SS", iso3: "SSD", name: "South Sudan", bbox: { north: 12.2, south: 3.5, east: 35.9, west: 24.0 }, priority: "HIGH" as const }
];

const providers = [
  { code: "PLANE_FINDER", name: "Plane Finder API", integrationStatus: "TESTING" as const, supportsLive: true, supportsHistorical: true, baseUrl: "https://api.planefinder.net/api" },
  { code: "RAPID_FLIGHT_RADAR", name: "RapidAPI Flight Radar", integrationStatus: "WORKING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://flight-radar1.p.rapidapi.com" },
  { code: "RAPID_ADSBEXCHANGE", name: "RapidAPI ADSBexchange", integrationStatus: "WORKING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://adsbexchange-com1.p.rapidapi.com" },
  { code: "RAPID_SKYLINK", name: "RapidAPI SkyLink", integrationStatus: "TESTING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://skylink-api.p.rapidapi.com" }
];
const activeProviderCodes = providers.map((provider) => provider.code);
const appEnvironment = (process.env.APP_ENVIRONMENT ?? process.env.NEXT_PUBLIC_APP_ENVIRONMENT ?? "DEV").toUpperCase();
const defaultLivePollingIntervalSeconds = appEnvironment === "PROD" ? 600 : 60;
const defaultRequestsPerHour = Math.ceil(3600 / defaultLivePollingIntervalSeconds);
const defaultRequestsPerDay = defaultRequestsPerHour * 24;

const adsbExchangeCoverageAreas = [
  { iso3: "BDI", name: "BDI mixed 01 100 NM", latitude: -3.4833, longitude: 29.9185, radiusNm: 100, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "LBY mixed 01 250 NM", latitude: 25.2083, longitude: 19.2083, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "LBY mixed 02 250 NM", latitude: 28.375, longitude: 12.1376, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "LBY mixed 03 250 NM", latitude: 31.5417, longitude: 22.7437, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "LBY mixed 04 250 NM", latitude: 22.0417, longitude: 12.1376, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "LBY mixed 05 250 NM", latitude: 22.0417, longitude: 22.7437, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "LBY mixed 06 100 NM", latitude: 31.9167, longitude: 16.0916, radiusNm: 100, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "LBY mixed 07 100 NM", latitude: 20.5167, longitude: 17.5058, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "LBY", name: "LBY mixed 08 100 NM", latitude: 30.65, longitude: 17.5058, radiusNm: 100, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "LBY mixed 09 100 NM", latitude: 33.1833, longitude: 11.8492, radiusNm: 100, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "LBY mixed 10 100 NM", latitude: 26.85, longitude: 24.5765, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "LBY", name: "LBY mixed 11 50 NM", latitude: 32.675, longitude: 9.8675, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "LBY", name: "LBY mixed 12 50 NM", latitude: 32.675, longitude: 14.11, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "LBY", name: "LBY mixed 13 50 NM", latitude: 33.3083, longitude: 17.6453, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "LBY", name: "LBY mixed 14 50 NM", latitude: 32.675, longitude: 18.3524, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 01 250 NM", latitude: -7.7917, longitude: 21.0972, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 02 250 NM", latitude: -1.4583, longitude: 27.4464, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 03 250 NM", latitude: 1.7083, longitude: 17.9226, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 04 250 NM", latitude: -10.9583, longitude: 27.4464, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 05 250 NM", latitude: -7.7917, longitude: 14.748, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 06 250 NM", latitude: 4.875, longitude: 24.2718, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 07 250 NM", latitude: -1.4583, longitude: 14.748, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 08 250 NM", latitude: -14.125, longitude: 17.9226, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 09 100 NM", latitude: 3.9833, longitude: 29.7271, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 10 100 NM", latitude: -2.35, longitude: 22.1081, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 11 100 NM", latitude: 3.9833, longitude: 13.2192, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 12 100 NM", latitude: -6.15, longitude: 25.9176, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 13 100 NM", latitude: -3.6167, longitude: 19.5684, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 14 100 NM", latitude: -12.4833, longitude: 13.2192, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 15 100 NM", latitude: -12.4833, longitude: 23.3779, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 16 100 NM", latitude: 0.1833, longitude: 22.1081, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 17 100 NM", latitude: 1.45, longitude: 30.9969, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 18 100 NM", latitude: -4.8833, longitude: 23.3779, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 19 250 NM", latitude: -7.7917, longitude: 30.621, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "COD", name: "COD mixed 20 100 NM", latitude: 5.25, longitude: 14.489, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 21 50 NM", latitude: -4.7583, longitude: 17.789, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 22 50 NM", latitude: 2.2083, longitude: 12.0747, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 23 50 NM", latitude: 2.8417, longitude: 27.9477, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 24 50 NM", latitude: -13.625, longitude: 31.1223, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 25 50 NM", latitude: 5.375, longitude: 31.1223, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "COD", name: "COD mixed 26 50 NM", latitude: -2.225, longitude: 20.3286, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MWI", name: "MWI mixed 01 250 NM", latitude: -14.6583, longitude: 35.3112, radiusNm: 250, priority: "NORMAL" as const },
  { iso3: "MWI", name: "MWI mixed 02 100 NM", latitude: -9.85, longitude: 33.7445, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MWI", name: "MWI mixed 03 50 NM", latitude: -9.725, longitude: 35.8249, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "ERI", name: "ERI mixed 01 250 NM", latitude: 14.9417, longitude: 39.0344, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "ERI", name: "ERI mixed 02 50 NM", latitude: 12.9083, longitude: 42.8349, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "ERI", name: "ERI mixed 03 50 NM", latitude: 17.975, longitude: 42.8349, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "ERI", name: "ERI mixed 04 50 NM", latitude: 16.7083, longitude: 42.8349, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "DJI", name: "DJI mixed 01 100 NM", latitude: 11.9167, longitude: 42.7388, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 01 250 NM", latitude: 15.8083, longitude: -6.313, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "MLI", name: "MLI mixed 02 250 NM", latitude: 22.1417, longitude: 0.3295, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "MLI", name: "MLI mixed 03 250 NM", latitude: 12.6417, longitude: 0.3295, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "MLI", name: "MLI mixed 04 250 NM", latitude: 22.1417, longitude: -9.6343, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "MLI", name: "MLI mixed 05 250 NM", latitude: 9.475, longitude: -9.6343, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "MLI", name: "MLI mixed 06 100 NM", latitude: 17.45, longitude: 3.3798, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 07 100 NM", latitude: 14.9167, longitude: -11.2337, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 08 100 NM", latitude: 23.7833, longitude: -4.5912, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 09 100 NM", latitude: 17.45, longitude: -0.6057, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 10 100 NM", latitude: 21.25, longitude: -4.5912, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 11 100 NM", latitude: 17.45, longitude: -11.2337, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 12 100 NM", latitude: 11.1167, longitude: -4.5912, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 13 100 NM", latitude: 18.7167, longitude: -3.2627, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 14 50 NM", latitude: 17.575, longitude: 1.5182, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 15 50 NM", latitude: 15.675, longitude: 4.1752, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 16 50 NM", latitude: 19.475, longitude: 4.1752, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 17 50 NM", latitude: 24.5417, longitude: 4.1752, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 18 50 NM", latitude: 9.975, longitude: 4.1752, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 19 50 NM", latitude: 13.1417, longitude: -12.4311, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 20 100 NM", latitude: 25.05, longitude: -4.5912, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "MLI", name: "MLI mixed 21 50 NM", latitude: 16.3083, longitude: 0.8539, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 01 250 NM", latitude: 16.275, longitude: 19.3223, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "TCD", name: "TCD mixed 02 250 NM", latitude: 9.9417, longitude: 19.3223, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "TCD", name: "TCD mixed 03 250 NM", latitude: 22.6083, longitude: 19.3223, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "TCD", name: "TCD mixed 04 250 NM", latitude: 13.1083, longitude: 12.7516, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "TCD", name: "TCD mixed 05 100 NM", latitude: 19.8167, longitude: 14.4548, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 06 100 NM", latitude: 13.4833, longitude: 23.6539, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 07 100 NM", latitude: 19.8167, longitude: 23.6539, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 08 100 NM", latitude: 8.4167, longitude: 14.4548, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 09 100 NM", latitude: 22.35, longitude: 14.4548, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 10 100 NM", latitude: 17.2833, longitude: 14.4548, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 11 100 NM", latitude: 8.4167, longitude: 23.6539, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 12 100 NM", latitude: 17.2833, longitude: 23.6539, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 13 50 NM", latitude: 11.075, longitude: 23.7836, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 14 100 NM", latitude: 22.35, longitude: 23.6539, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 15 50 NM", latitude: 15.5083, longitude: 23.7836, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "TCD", name: "TCD mixed 16 50 NM", latitude: 18.675, longitude: 15.8986, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "LSO", name: "LSO mixed 01 100 NM", latitude: -29.6833, longitude: 28.1693, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "SSD", name: "SSD mixed 01 250 NM", latitude: 9.2083, longitude: 29.7623, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "SSD", name: "SSD mixed 02 250 NM", latitude: 6.0417, longitude: 32.959, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "SSD", name: "SSD mixed 03 250 NM", latitude: 6.0417, longitude: 26.5657, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "SSD", name: "SSD mixed 04 100 NM", latitude: 10.85, longitude: 35.2555, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "SSD", name: "SSD mixed 05 100 NM", latitude: 10.85, longitude: 25.0263, radiusNm: 100, priority: "NORMAL" as const },
  { iso3: "SSD", name: "SSD mixed 06 50 NM", latitude: 11.6083, longitude: 33.4637, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "SSD", name: "SSD mixed 07 50 NM", latitude: 11.6083, longitude: 26.4311, radiusNm: 50, priority: "NORMAL" as const },
  { iso3: "SSD", name: "SSD mixed 08 50 NM", latitude: 8.4417, longitude: 36.021, radiusNm: 50, priority: "NORMAL" as const }
];

const referenceDataSyncConfigs = [
  { source: "OURAIRPORTS" as const, enabled: true, sunday: true, timeOfDayLocal: "03:30" },
  { source: "OPENSKY_AIRCRAFT" as const, enabled: true, sunday: true, timeOfDayLocal: "03:45" },
  { source: "OPENFLIGHTS" as const, enabled: true, sunday: true, timeOfDayLocal: "04:00" },
  { source: "WIKIDATA" as const, enabled: false, sunday: true, timeOfDayLocal: "04:15" }
];

async function main(): Promise<void> {
  for (const country of countries) {
    const created = await prisma.country.upsert({
      where: { iso3: country.iso3 },
      update: {
        name: country.name,
        primaryUseCase: country.primaryUseCase,
        notes: "Approximate bounding box only. Official FIR polygon is not loaded yet."
      },
      create: {
        iso2: country.iso2,
        iso3: country.iso3,
        name: country.name,
        enabled: true,
        priority: country.priority,
        primaryUseCase: country.primaryUseCase,
        notes: "Approximate bounding box only. Official FIR polygon is not loaded yet."
      }
    });

    await prisma.collectionArea.upsert({
      where: { id: `${created.iso3}-bbox` },
      update: {
        bboxNorth: country.bbox.north,
        bboxSouth: country.bbox.south,
        bboxEast: country.bbox.east,
        bboxWest: country.bbox.west,
        geometryQuality: "APPROXIMATE_BBOX"
      },
      create: {
        id: `${created.iso3}-bbox`,
        countryId: created.id,
        type: "BBOX",
        name: `${country.name} approximate bbox`,
        bboxNorth: country.bbox.north,
        bboxSouth: country.bbox.south,
        bboxEast: country.bbox.east,
        bboxWest: country.bbox.west,
        geometryQuality: "APPROXIMATE_BBOX",
        enabled: true
      }
    });
  }

  for (const provider of providers) {
    await prisma.provider.upsert({
      where: { code: provider.code },
      update: provider,
      create: { ...provider, enabled: false }
    });
  }

  await prisma.provider.updateMany({
    where: { code: { notIn: activeProviderCodes } },
    data: { enabled: false, integrationStatus: "PLANNED", notes: "Removed from active provider set. Kept only for historical database references." }
  });
  const inactiveProviders = await prisma.provider.findMany({ where: { code: { notIn: activeProviderCodes } }, select: { id: true } });
  if (inactiveProviders.length > 0) {
    await prisma.providerCountryConfig.updateMany({
      where: { providerId: { in: inactiveProviders.map((provider) => provider.id) } },
      data: { enabled: false, liveEnabled: false, historicalEnabled: false, notes: "Inactive legacy provider; hidden from collection UI." }
    });
  }

  const allProviders = await prisma.provider.findMany({ where: { code: { in: activeProviderCodes } } });
  const activeProviderIds = allProviders.map((provider) => provider.id);
  const allCountries = await prisma.country.findMany();
  for (const provider of allProviders) {
    for (const country of allCountries) {
      await prisma.providerCountryConfig.upsert({
        where: { providerId_countryId: { providerId: provider.id, countryId: country.id } },
        update: {},
        create: {
          providerId: provider.id,
          countryId: country.id,
          enabled: false,
          liveEnabled: false,
          historicalEnabled: false,
          livePollingIntervalSeconds: defaultLivePollingIntervalSeconds,
          minPollingIntervalSeconds: 30,
          maxRequestsPerMinute: 1,
          maxRequestsPerHour: defaultRequestsPerHour,
          maxRequestsPerDay: defaultRequestsPerDay,
          maxCreditsPerDay: null,
          priority: country.priority,
          lowVolumeThresholdCount: 1,
          lowVolumeWindowMinutes: 30,
          noDataAlertAfterMinutes: 30,
          notes: "Seeded default; adjust from Collection Control."
        }
      });
    }
  }

  await prisma.providerCountryConfig.updateMany({
    where: { maxRequestsPerHour: 1000 },
    data: { maxRequestsPerHour: defaultRequestsPerHour }
  });

  await prisma.providerCountryConfig.updateMany({
    where: { providerId: { in: activeProviderIds } },
    data: {
      livePollingIntervalSeconds: defaultLivePollingIntervalSeconds,
      maxRequestsPerMinute: 1,
      maxRequestsPerHour: defaultRequestsPerHour,
      maxRequestsPerDay: defaultRequestsPerDay
    }
  });

  const planeFinder = await prisma.provider.findUnique({ where: { code: "PLANE_FINDER" } });
  if (planeFinder) {
    await prisma.providerCountryConfig.updateMany({
      where: { providerId: planeFinder.id },
      data: {
        livePollingIntervalSeconds: defaultLivePollingIntervalSeconds,
        maxRequestsPerMinute: 1,
        maxRequestsPerHour: defaultRequestsPerHour,
        maxRequestsPerDay: defaultRequestsPerDay,
        maxCreditsPerDay: defaultRequestsPerDay * 10,
        notes: `Plane Finder Growth default: standard live BBOX endpoint, 10 credits per request, ${defaultLivePollingIntervalSeconds} second polling for ${appEnvironment}. Enable per country/provider only after API key is configured.`
      }
    });
  }

  const adsbExchange = await prisma.provider.findUnique({ where: { code: "RAPID_ADSBEXCHANGE" } });
  if (adsbExchange) {
    const plannedCoverageNames = new Set(adsbExchangeCoverageAreas.map((coverageArea) => coverageArea.name));
    const adsbCountries = await prisma.country.findMany({
      where: { iso3: { in: [...new Set(adsbExchangeCoverageAreas.map((coverageArea) => coverageArea.iso3))] } }
    });
    const countryByIso3 = new Map(adsbCountries.map((country) => [country.iso3, country]));

    await prisma.providerCoverageArea.updateMany({
      where: {
        providerId: adsbExchange.id,
        name: { notIn: [...plannedCoverageNames] }
      },
      data: {
        enabled: false,
        notes: "Disabled by ADSBexchange mixed balanced coverage plan seed. Kept for audit/history only."
      }
    });

    for (const country of adsbCountries) {
      const requestCount = adsbExchangeCoverageAreas.filter((coverageArea) => coverageArea.iso3 === country.iso3).length;
      await prisma.providerCountryConfig.update({
        where: { providerId_countryId: { providerId: adsbExchange.id, countryId: country.id } },
        data: {
          livePollingIntervalSeconds: defaultLivePollingIntervalSeconds,
          liveLatitude: null,
          liveLongitude: null,
          liveRadiusNm: null,
          maxRequestsPerMinute: null,
          maxRequestsPerHour: requestCount * defaultRequestsPerHour,
          maxRequestsPerDay: requestCount * defaultRequestsPerDay,
          notes: `ADSBexchange mixed balanced BBOX coverage plan: ${requestCount} radius requests every ${defaultLivePollingIntervalSeconds} seconds for ${appEnvironment}. DEV test first; PROD after approval.`
        }
      });
    }

    for (const coverageArea of adsbExchangeCoverageAreas) {
      const country = countryByIso3.get(coverageArea.iso3);
      if (!country) continue;
      await prisma.providerCoverageArea.upsert({
        where: {
          providerId_countryId_name: {
            providerId: adsbExchange.id,
            countryId: country.id,
            name: coverageArea.name
          }
        },
        update: {
          enabled: true,
          latitude: coverageArea.latitude,
          longitude: coverageArea.longitude,
          radiusNm: coverageArea.radiusNm,
          priority: coverageArea.priority,
          notes: "ADSBexchange mixed balanced BBOX coverage plan. Raw responses are stored per radius request; deduplication belongs to the downstream normalized/analytics layer."
        },
        create: {
          providerId: adsbExchange.id,
          countryId: country.id,
          type: "RADIUS",
          name: coverageArea.name,
          enabled: true,
          latitude: coverageArea.latitude,
          longitude: coverageArea.longitude,
          radiusNm: coverageArea.radiusNm,
          priority: coverageArea.priority,
          notes: "ADSBexchange mixed balanced BBOX coverage plan. Raw responses are stored per radius request; deduplication belongs to the downstream normalized/analytics layer."
        }
      });
    }
  }

  await prisma.alertRule.upsert({
    where: { code: "collector-heartbeat-missing" },
    update: {},
    create: {
      code: "collector-heartbeat-missing",
      name: "Collector heartbeat missing",
      enabled: true,
      severity: "CRITICAL",
      alertType: "COLLECTOR_HEARTBEAT_MISSING",
      evaluationWindowMinutes: 5,
      thresholdValue: 5,
      cooldownMinutes: 15,
      notificationChannel: "DASHBOARD"
    }
  });

  await prisma.alertRule.upsert({
    where: { code: "provider-no-data-default" },
    update: {},
    create: {
      code: "provider-no-data-default",
      name: "Provider-country no data",
      enabled: true,
      severity: "WARNING",
      alertType: "PROVIDER_NO_DATA",
      evaluationWindowMinutes: 30,
      thresholdValue: 0,
      cooldownMinutes: 30,
      notificationChannel: "DASHBOARD"
    }
  });

  for (const config of referenceDataSyncConfigs) {
    await prisma.referenceDataSyncConfig.upsert({
      where: { source: config.source },
      update: {
        enabled: config.enabled,
        sunday: config.sunday,
        timeOfDayLocal: config.timeOfDayLocal
      },
      create: {
        source: config.source,
        enabled: config.enabled,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: config.sunday,
        timeOfDayLocal: config.timeOfDayLocal,
        timezone: "Europe/Berlin"
      }
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
