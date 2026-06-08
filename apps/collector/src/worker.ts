import os from "node:os";
import { Queue, Worker } from "bullmq";
import pino from "pino";
import { prisma } from "@flight-data-collector/db";
import { createProviderAdapters } from "@flight-data-collector/providers";
import { evaluateAlerts } from "./alerts.js";
import { rebuildDetectedFlights, storeFailedFetchRun, storeFetchResult } from "./ingest.js";
import { enqueueDueReferenceDataSyncs, syncReferenceData } from "./reference-data.js";

const logger = pino({ name: "collector" });
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null
};
const queue = new Queue("collection", { connection: redisConnection });
const adapters = createProviderAdapters();
const adapterCodes = [...adapters.keys()];
const serviceName = "collector";
const hostname = os.hostname();
const startedAt = new Date();
const scheduled = new Map<string, number>();
const providerLastRequestAt = new Map<string, number>();
const referenceDataSources = new Set(["OURAIRPORTS", "OPENSKY_AIRCRAFT", "OPENFLIGHTS", "WIKIDATA"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForProviderRequestSlot(providerCode: string): Promise<void> {
  const minIntervalMs =
    providerCode === "PLANE_FINDER" ? Math.max(Number(process.env.PLANE_FINDER_MIN_REQUEST_INTERVAL_MS ?? 10_000), 0) : 0;
  if (minIntervalMs === 0) return;

  const lastRequestAt = providerLastRequestAt.get(providerCode) ?? 0;
  const waitMs = Math.max(lastRequestAt + minIntervalMs - Date.now(), 0);
  if (waitMs > 0) {
    logger.info({ providerCode, waitMs }, "waiting for provider request slot");
    await sleep(waitMs);
  }
  providerLastRequestAt.set(providerCode, Date.now());
}

async function writeHeartbeat(status: "STARTING" | "RUNNING" | "DEGRADED" | "STOPPED" = "RUNNING"): Promise<void> {
  await prisma.collectorHeartbeat.upsert({
    where: { serviceName_hostname: { serviceName, hostname } },
    update: { lastSeenAt: new Date(), status, processId: process.pid, version: process.env.npm_package_version, metadataJson: { queue: "collection" } },
    create: { serviceName, hostname, processId: process.pid, startedAt, lastSeenAt: new Date(), status, version: process.env.npm_package_version, metadataJson: { queue: "collection" } }
  });
}

async function reloadSchedules(): Promise<void> {
  const configs = await prisma.providerCountryConfig.findMany({
    where: { enabled: true, liveEnabled: true, provider: { enabled: true, code: { in: adapterCodes } }, country: { enabled: true } },
    include: { provider: true, country: { include: { collectionAreas: { where: { enabled: true }, take: 1 } } } },
    orderBy: [{ providerId: "asc" }, { countryId: "asc" }]
  });
  let startupDelayMs = 0;
  for (const config of configs) {
    const existingInterval = scheduled.get(config.id);
    if (existingInterval === config.livePollingIntervalSeconds) continue;
    const isNewSchedule = existingInterval == null;
    await queue.upsertJobScheduler(
      `live:${config.id}`,
      { every: config.livePollingIntervalSeconds * 1000 },
      {
        name: "live-fetch",
        data: { providerId: config.providerId, countryId: config.countryId, providerCode: config.provider.code },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 1000 }
      }
    );
    scheduled.set(config.id, config.livePollingIntervalSeconds);
    logger.info({ configId: config.id, interval: config.livePollingIntervalSeconds }, "scheduled live fetch");
    if (isNewSchedule) {
      await queue.add(
        "live-fetch",
        { providerId: config.providerId, countryId: config.countryId, providerCode: config.provider.code },
        {
          jobId: `live:startup:${config.id}`,
          delay: startupDelayMs,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000
        }
      );
      logger.info({ configId: config.id, delay: startupDelayMs }, "queued startup live fetch");
      startupDelayMs += config.provider.code === "PLANE_FINDER" ? 10_000 : 1_000;
    }
  }
}

async function runFetch(data: { providerId: string; countryId: string; providerCode?: string }, mode: "LIVE" | "MANUAL_TEST"): Promise<void> {
  const startedAt = new Date();
  const [provider, country] = await Promise.all([
    prisma.provider.findUniqueOrThrow({ where: { id: data.providerId } }),
    prisma.country.findUniqueOrThrow({ where: { id: data.countryId }, include: { collectionAreas: { where: { enabled: true }, take: 1 } } })
  ]);
  const [config, providerCoverageAreas] = await Promise.all([
    prisma.providerCountryConfig.findUnique({
      where: { providerId_countryId: { providerId: provider.id, countryId: country.id } }
    }),
    prisma.providerCoverageArea.findMany({
      where: { providerId: provider.id, countryId: country.id, enabled: true },
      orderBy: [{ priority: "desc" }, { name: "asc" }]
    })
  ]);
  const area = country.collectionAreas[0];
  const adapter = adapters.get(data.providerCode ?? provider.code);
  if (!area || !adapter || area.bboxNorth == null || area.bboxSouth == null || area.bboxEast == null || area.bboxWest == null) {
    await storeFailedFetchRun({
      providerId: provider.id,
      countryId: country.id,
      collectionAreaId: area?.id,
      mode,
      endpoint: "unavailable",
      requestParamsJson: {},
      startedAt,
      error: new Error("Provider adapter or enabled bbox collection area is missing")
    });
    return;
  }

  const livePoints =
    providerCoverageAreas.length > 0
      ? providerCoverageAreas
          .filter((coverageArea) => coverageArea.type === "RADIUS" && coverageArea.latitude != null && coverageArea.longitude != null && coverageArea.radiusNm != null)
          .map((coverageArea) => ({
            name: coverageArea.name,
            livePoint: {
              latitude: coverageArea.latitude as number,
              longitude: coverageArea.longitude as number,
              radiusNm: coverageArea.radiusNm as number
            }
          }))
      : [
          {
            name: "provider-country-default",
            livePoint:
              config?.liveLatitude != null && config.liveLongitude != null && config.liveRadiusNm != null
                ? { latitude: config.liveLatitude, longitude: config.liveLongitude, radiusNm: config.liveRadiusNm }
                : undefined
          }
        ];

  for (const coverage of livePoints) {
    const pointStartedAt = new Date();
    try {
      await waitForProviderRequestSlot(provider.code);
      const result = await adapter.fetchLivePositions({
        bbox: { north: area.bboxNorth, south: area.bboxSouth, east: area.bboxEast, west: area.bboxWest },
        livePoint: coverage.livePoint
      });
      await storeFetchResult({ providerId: provider.id, countryId: country.id, collectionAreaId: area.id, mode, startedAt: pointStartedAt, result });
    } catch (error) {
      await storeFailedFetchRun({
        providerId: provider.id,
        countryId: country.id,
        collectionAreaId: area.id,
        mode,
        endpoint: `${provider.code}:live:${coverage.name}`,
        requestParamsJson: { countryId: country.id, coverageName: coverage.name, livePoint: coverage.livePoint },
        startedAt: pointStartedAt,
        error
      });
    }
  }
}

async function runHistoricalSnapshot(data: { providerId: string; countryId: string; collectionAreaId?: string; timestamp: string }): Promise<void> {
  const startedAt = new Date();
  const snapshotAt = new Date(data.timestamp);
  const [provider, country] = await Promise.all([
    prisma.provider.findUniqueOrThrow({ where: { id: data.providerId } }),
    prisma.country.findUniqueOrThrow({ where: { id: data.countryId }, include: { collectionAreas: { where: { enabled: true }, take: 1 } } })
  ]);
  const area = data.collectionAreaId
    ? await prisma.collectionArea.findUnique({ where: { id: data.collectionAreaId } })
    : country.collectionAreas[0];
  const adapter = adapters.get(provider.code);

  if (Number.isNaN(snapshotAt.getTime())) {
    await storeFailedFetchRun({
      providerId: provider.id,
      countryId: country.id,
      collectionAreaId: area?.id,
      mode: "HISTORICAL",
      endpoint: `${provider.code}:historical-snapshot`,
      requestParamsJson: { timestamp: data.timestamp },
      startedAt,
      error: new Error(`Invalid historical snapshot timestamp: ${data.timestamp}`)
    });
    return;
  }

  if (!area || !adapter || !adapter.supportsHistorical || area.bboxNorth == null || area.bboxSouth == null || area.bboxEast == null || area.bboxWest == null) {
    await storeFailedFetchRun({
      providerId: provider.id,
      countryId: country.id,
      collectionAreaId: area?.id,
      mode: "HISTORICAL",
      endpoint: `${provider.code}:historical-snapshot`,
      requestParamsJson: { timestamp: snapshotAt.toISOString() },
      startedAt,
      error: new Error("Provider adapter, historical support, or enabled bbox collection area is missing")
    });
    return;
  }

  try {
    await waitForProviderRequestSlot(provider.code);
    const result = await adapter.fetchHistoricalPositions({
      bbox: { north: area.bboxNorth, south: area.bboxSouth, east: area.bboxEast, west: area.bboxWest },
      from: snapshotAt,
      to: snapshotAt
    });
    await storeFetchResult({ providerId: provider.id, countryId: country.id, collectionAreaId: area.id, mode: "HISTORICAL", startedAt, result });
  } catch (error) {
    await storeFailedFetchRun({
      providerId: provider.id,
      countryId: country.id,
      collectionAreaId: area.id,
      mode: "HISTORICAL",
      endpoint: `${provider.code}:historical-snapshot`,
      requestParamsJson: { timestamp: snapshotAt.toISOString() },
      startedAt,
      error
    });
  }
}

new Worker(
  "collection",
  async (job) => {
    if (job.name === "alert-evaluation") {
      await evaluateAlerts();
      return;
    }
    if (job.name === "reference-data-sync") {
      const source = (job.data as { source?: string }).source;
      if (!source || !referenceDataSources.has(source)) {
        throw new Error(`Unsupported reference data source: ${source ?? "missing"}`);
      }
      await syncReferenceData(source as "OURAIRPORTS" | "OPENSKY_AIRCRAFT" | "OPENFLIGHTS" | "WIKIDATA");
      return;
    }
    if (job.name === "rebuild-detected-flights") {
      const result = await rebuildDetectedFlights();
      logger.info(result, "rebuilt detected flights");
      return;
    }
    if (job.name === "manual-test-fetch") {
      await runFetch(job.data as { providerId: string; countryId: string }, "MANUAL_TEST");
      return;
    }
    if (job.name === "historical-snapshot") {
      await runHistoricalSnapshot(job.data as { providerId: string; countryId: string; collectionAreaId?: string; timestamp: string });
      return;
    }
    if (job.name === "historical-backfill") {
      logger.info({ jobId: job.id, data: job.data }, "historical backfill queued placeholder");
      return;
    }
    await runFetch(job.data as { providerId: string; countryId: string; providerCode?: string }, "LIVE");
  },
  { connection: redisConnection, concurrency: 4 }
);

await writeHeartbeat("STARTING");
await reloadSchedules();
await enqueueDueReferenceDataSyncs(queue);
await queue.upsertJobScheduler("alerts:evaluate", { every: Number(process.env.ALERT_EVALUATION_SECONDS ?? 60) * 1000 }, { name: "alert-evaluation", data: {} });

setInterval(() => void writeHeartbeat("RUNNING").catch((error) => logger.error(error)), Number(process.env.COLLECTOR_HEARTBEAT_SECONDS ?? 30) * 1000);
setInterval(() => void reloadSchedules().catch((error) => logger.error(error)), Number(process.env.COLLECTOR_CONFIG_RELOAD_SECONDS ?? 60) * 1000);
setInterval(() => void enqueueDueReferenceDataSyncs(queue).catch((error) => logger.error(error)), 60 * 1000);

logger.info("collector started");
