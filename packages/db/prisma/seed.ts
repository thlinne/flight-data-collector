import { PrismaClient } from "@prisma/client";

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
  { code: "MOCK", name: "Mock Provider", integrationStatus: "TESTING" as const, supportsLive: true, supportsHistorical: true, baseUrl: "mock://local" },
  { code: "FR24", name: "Flightradar24", integrationStatus: "PLANNED" as const, supportsLive: true, supportsHistorical: true, baseUrl: "https://api.flightradar24.com" },
  { code: "PLANE_FINDER", name: "Plane Finder", integrationStatus: "PLANNED" as const, supportsLive: true, supportsHistorical: true, baseUrl: null },
  { code: "AIRNAV_RADARBOX", name: "AirNav RadarBox", integrationStatus: "PLANNED" as const, supportsLive: true, supportsHistorical: true, baseUrl: null },
  { code: "FLIGHTAWARE", name: "FlightAware AeroAPI", integrationStatus: "PLANNED" as const, supportsLive: true, supportsHistorical: true, baseUrl: "https://aeroapi.flightaware.com" },
  { code: "RAPID_FLIGHT_RADAR", name: "RapidAPI Flight Radar", integrationStatus: "WORKING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://flight-radar1.p.rapidapi.com" },
  { code: "RAPID_ADSBEXCHANGE", name: "RapidAPI ADSBexchange", integrationStatus: "WORKING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://adsbexchange-com1.p.rapidapi.com" },
  { code: "RAPID_SKYLINK", name: "RapidAPI SkyLink", integrationStatus: "TESTING" as const, supportsLive: true, supportsHistorical: false, baseUrl: "https://skylink-api.p.rapidapi.com" }
];

const adsbExchangeCoverageAreas = [
  { iso3: "LBY", name: "Libya Tripoli west/northwest", latitude: 32.8872, longitude: 13.1913, radiusNm: 250, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "Libya Benghazi northeast", latitude: 32.1167, longitude: 20.0667, radiusNm: 250, priority: "CRITICAL" as const },
  { iso3: "LBY", name: "Libya Sabha central/south", latitude: 27.0377, longitude: 14.4283, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "Libya Kufra southeast", latitude: 24.1786, longitude: 23.313, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "LBY", name: "Libya Ghat southwest", latitude: 25.1456, longitude: 10.1426, radiusNm: 250, priority: "HIGH" as const },
  { iso3: "BDI", name: "Burundi Bujumbura west", latitude: -3.324, longitude: 29.318, radiusNm: 120, priority: "CRITICAL" as const },
  { iso3: "BDI", name: "Burundi Gitega center", latitude: -3.427, longitude: 29.924, radiusNm: 120, priority: "CRITICAL" as const },
  { iso3: "BDI", name: "Burundi Ngozi north", latitude: -2.91, longitude: 29.83, radiusNm: 90, priority: "HIGH" as const }
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
      create: { ...provider, enabled: provider.code === "MOCK" }
    });
  }

  const allProviders = await prisma.provider.findMany();
  const allCountries = await prisma.country.findMany();
  for (const provider of allProviders) {
    for (const country of allCountries) {
      await prisma.providerCountryConfig.upsert({
        where: { providerId_countryId: { providerId: provider.id, countryId: country.id } },
        update: {},
        create: {
          providerId: provider.id,
          countryId: country.id,
          enabled: provider.code === "MOCK",
          liveEnabled: provider.code === "MOCK",
          historicalEnabled: provider.code === "MOCK",
          livePollingIntervalSeconds: provider.code === "RAPID_SKYLINK" ? 900 : country.iso3 === "BDI" ? 60 : 300,
          minPollingIntervalSeconds: 30,
          maxRequestsPerMinute: 1,
          maxRequestsPerHour: provider.code === "RAPID_SKYLINK" ? 4 : 60,
          maxRequestsPerDay: null,
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
    data: { maxRequestsPerHour: 60 }
  });

  const adsbExchange = await prisma.provider.findUnique({ where: { code: "RAPID_ADSBEXCHANGE" } });
  const libya = await prisma.country.findUnique({ where: { iso3: "LBY" } });
  if (adsbExchange && libya) {
    await prisma.providerCountryConfig.update({
      where: { providerId_countryId: { providerId: adsbExchange.id, countryId: libya.id } },
      data: {
        liveLatitude: 32.8872,
        liveLongitude: 13.1913,
        liveRadiusNm: 50,
        notes: "ADSBexchange test point: Tripoli area, radius 50 NM."
      }
    });
  }

  if (adsbExchange) {
    for (const coverageArea of adsbExchangeCoverageAreas) {
      const country = await prisma.country.findUnique({ where: { iso3: coverageArea.iso3 } });
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
          notes: "Initial coarse ANSP-airspace coverage candidate for ADSBexchange evaluation."
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
          notes: "Initial coarse ANSP-airspace coverage candidate for ADSBexchange evaluation."
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
