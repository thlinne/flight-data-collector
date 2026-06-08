import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPointInBoundingBox } from "@flight-data-collector/core";
import { prisma } from "@flight-data-collector/db";
import { createProviderAdapters } from "@flight-data-collector/providers";
import { storeFetchResult } from "./ingest.js";

type ParsedArgs = {
  providerCode: string;
  countryIso3: string;
  circleName?: string;
  store: boolean;
  list: boolean;
};

type CoverageOption = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusNm: number;
};

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
    process.env[key] ??= value;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [providerCode, countryIso3, ...rest] = argv;
  if (!providerCode || !countryIso3) {
    throw new Error(
      [
        "Usage:",
        "  pnpm debug:provider PROVIDER_CODE COUNTRY_ISO3 --circle \"Coverage area name\"",
        "  pnpm debug:provider PROVIDER_CODE COUNTRY_ISO3 --list",
        "  pnpm debug:provider PROVIDER_CODE COUNTRY_ISO3 --circle \"Coverage area name\" --store",
        "",
        "Example:",
        "  pnpm debug:provider RAPID_ADSBEXCHANGE LBY --circle \"LBY mixed 01 250 NM\""
      ].join("\n")
    );
  }

  let circleName: string | undefined;
  let store = false;
  let list = false;

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--store") {
      store = true;
      continue;
    }
    if (value === "--list") {
      list = true;
      continue;
    }
    if (value === "--circle") {
      circleName = rest[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return { providerCode: providerCode.toUpperCase(), countryIso3: countryIso3.toUpperCase(), circleName, store, list };
}

function rawAircraftCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const object = payload as Record<string, unknown>;
  if (Array.isArray(object.ac)) return object.ac.length;
  if (Array.isArray(object.flightsList)) return object.flightsList.length;
  if (Array.isArray(object.data)) return object.data.length;
  if (Array.isArray(object.aircraft)) return object.aircraft.length;
  return 0;
}

function uniqueCount(values: Array<string | null | undefined>): number {
  return new Set(values.map((value) => value?.trim().toUpperCase()).filter((value): value is string => Boolean(value))).size;
}

function printCoverageList(options: CoverageOption[]): void {
  console.table(
    options.map((option) => ({
      name: option.name,
      latitude: option.latitude,
      longitude: option.longitude,
      radiusNm: option.radiusNm
    }))
  );
}

loadEnvFile();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const adapters = createProviderAdapters();
  const adapter = adapters.get(args.providerCode);
  if (!adapter) throw new Error(`No provider adapter found for ${args.providerCode}.`);

  const provider = await prisma.provider.findUniqueOrThrow({ where: { code: args.providerCode } });
  const country = await prisma.country.findUniqueOrThrow({
    where: { iso3: args.countryIso3 },
    include: { collectionAreas: { where: { enabled: true }, take: 1 } }
  });
  const area = country.collectionAreas[0];
  if (!area || area.bboxNorth == null || area.bboxSouth == null || area.bboxEast == null || area.bboxWest == null) {
    throw new Error(`Country ${country.iso3} has no enabled BBOX collection area.`);
  }

  const coverageOptions = (
    await prisma.providerCoverageArea.findMany({
      where: {
        providerId: provider.id,
        countryId: country.id,
        enabled: true,
        type: "RADIUS",
        latitude: { not: null },
        longitude: { not: null },
        radiusNm: { not: null }
      },
      orderBy: [{ priority: "desc" }, { name: "asc" }]
    })
  ).map((coverageArea) => ({
    id: coverageArea.id,
    name: coverageArea.name,
    latitude: coverageArea.latitude as number,
    longitude: coverageArea.longitude as number,
    radiusNm: coverageArea.radiusNm as number
  }));

  if (coverageOptions.length === 0) {
    throw new Error(`No enabled radius coverage areas found for ${provider.code} / ${country.iso3}.`);
  }

  if (args.list) {
    printCoverageList(coverageOptions);
    return;
  }

  const selected =
    args.circleName == null
      ? coverageOptions[0]
      : coverageOptions.find((option) => option.name.toLowerCase() === args.circleName?.toLowerCase());

  if (!selected) {
    console.error(`Coverage area not found: ${args.circleName}`);
    console.error("Available coverage areas:");
    printCoverageList(coverageOptions);
    process.exit(1);
  }

  const bbox = { north: area.bboxNorth, south: area.bboxSouth, east: area.bboxEast, west: area.bboxWest };
  const startedAt = new Date();
  const result = await adapter.fetchLivePositions({
    bbox,
    livePoint: {
      latitude: selected.latitude,
      longitude: selected.longitude,
      radiusNm: selected.radiusNm
    }
  });

  const inBboxRecords = result.records.filter((record) => isPointInBoundingBox(record.latitude, record.longitude, bbox));
  const examples = result.records.slice(0, 5).map((record) => ({
    observedAt: record.observedAt.toISOString(),
    icao24: record.icao24,
    callsign: record.callsign,
    registration: record.registration,
    type: record.aircraftTypeIcao,
    lat: record.latitude,
    lon: record.longitude,
    altitudeFt: record.altitudeFt,
    speedKt: record.groundSpeedKt
  }));

  console.log("Provider debug result");
  console.table([
    {
      provider: provider.code,
      country: country.iso3,
      circle: selected.name,
      radiusNm: selected.radiusNm,
      latitude: selected.latitude,
      longitude: selected.longitude,
      endpoint: result.endpoint,
      httpStatus: result.httpStatus ?? "n/a",
      responseBytes: result.responseByteSize ?? JSON.stringify(result.rawPayload).length,
      rawAircraft: rawAircraftCount(result.rawPayload),
      normalized: result.records.length,
      inCountryBbox: inBboxRecords.length,
      uniqueIcao24: uniqueCount(result.records.map((record) => record.icao24)),
      rateLimitRemaining: result.rateLimitInfo?.remaining ?? "n/a"
    }
  ]);

  if (examples.length > 0) {
    console.log("Examples");
    console.table(examples);
  } else {
    console.log("No normalized records returned for this circle.");
  }

  if (args.store) {
    const stored = await storeFetchResult({
      providerId: provider.id,
      countryId: country.id,
      collectionAreaId: area.id,
      mode: "MANUAL_TEST",
      startedAt,
      result
    });
    console.log("Stored result");
    console.table([
      {
        fetchRunId: stored.fetchRun.id,
        rawResponseId: stored.rawResponse.id,
        recordCount: stored.fetchRun.recordCount,
        responseHash: stored.fetchRun.responseHash
      }
    ]);
  } else {
    console.log("Dry run only. Add --store to write this result into the database.");
  }
}

main()
  .catch((error) => {
    if (error instanceof Error) {
      console.error(error.message);
      if (error.cause) console.error("Cause:", error.cause);
      if (error.stack) console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
