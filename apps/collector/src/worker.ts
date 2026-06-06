import os from "node:os";
import { Queue, Worker } from "bullmq";
import pino from "pino";
import { prisma } from "@flight-data-collector/db";
import { createProviderAdapters } from "@flight-data-collector/providers";
import { evaluateAlerts } from "./alerts.js";
import { storeFailedFetchRun, storeFetchResult } from "./ingest.js";

const logger = pino({ name: "collector" });
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null
};
const queue = new Queue("collection", { connection: redisConnection });
const adapters = createProviderAdapters();
const serviceName = "collector";
const hostname = os.hostname();
const startedAt = new Date();
const scheduled = new Map<string, number>();

async function writeHeartbeat(status: "STARTING" | "RUNNING" | "DEGRADED" | "STOPPED" = "RUNNING"): Promise<void> {
  await prisma.collectorHeartbeat.upsert({
    where: { serviceName_hostname: { serviceName, hostname } },
    update: { lastSeenAt: new Date(), status, processId: process.pid, version: process.env.npm_package_version, metadataJson: { queue: "collection" } },
    create: { serviceName, hostname, processId: process.pid, startedAt, lastSeenAt: new Date(), status, version: process.env.npm_package_version, metadataJson: { queue: "collection" } }
  });
}

async function reloadSchedules(): Promise<void> {
  const configs = await prisma.providerCountryConfig.findMany({
    where: { enabled: true, liveEnabled: true, provider: { enabled: true }, country: { enabled: true } },
    include: { provider: true, country: { include: { collectionAreas: { where: { enabled: true }, take: 1 } } } }
  });
  for (const config of configs) {
    const existingInterval = scheduled.get(config.id);
    if (existingInterval === config.livePollingIntervalSeconds) continue;
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

new Worker(
  "collection",
  async (job) => {
    if (job.name === "alert-evaluation") {
      await evaluateAlerts();
      return;
    }
    if (job.name === "manual-test-fetch") {
      await runFetch(job.data as { providerId: string; countryId: string }, "MANUAL_TEST");
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
await queue.upsertJobScheduler("alerts:evaluate", { every: Number(process.env.ALERT_EVALUATION_SECONDS ?? 60) * 1000 }, { name: "alert-evaluation", data: {} });

setInterval(() => void writeHeartbeat("RUNNING").catch((error) => logger.error(error)), Number(process.env.COLLECTOR_HEARTBEAT_SECONDS ?? 30) * 1000);
setInterval(() => void reloadSchedules().catch((error) => logger.error(error)), Number(process.env.COLLECTOR_CONFIG_RELOAD_SECONDS ?? 60) * 1000);

logger.info("collector started");
