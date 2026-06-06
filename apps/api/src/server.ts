import cors from "@fastify/cors";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "@flight-data-collector/db";
import type { TransactionClient } from "@flight-data-collector/db";

const app = Fastify({ logger: true });
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null
};
const collectionQueue = new Queue("collection", { connection: redisConnection });

await app.register(cors, { origin: true });

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health") return;
  const expectedUser = process.env.ADMIN_USERNAME ?? "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "change-me";
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Basic ")) {
    return reply.header("WWW-Authenticate", "Basic").code(401).send({ error: "Authentication required" });
  }
  const [user, password] = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8").split(":");
  if (user !== expectedUser || password !== expectedPassword) {
    return reply.code(403).send({ error: "Invalid credentials" });
  }
});

app.get("/health", async () => ({ ok: true, service: "api" }));

app.get("/overview", async () => {
  const now = new Date();
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, thisWeek, thisMonth, activeCountries, activeProviders, failedLast24h, openCritical] = await Promise.all([
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: day } } }),
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: week } } }),
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: month } } }),
    prisma.country.count({ where: { enabled: true } }),
    prisma.provider.count({ where: { enabled: true } }),
    prisma.providerFetchRun.count({ where: { success: false, startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    prisma.alertEvent.count({ where: { status: "OPEN", severity: "CRITICAL" } })
  ]);
  const [countries, configs] = await Promise.all([
    prisma.country.findMany({ orderBy: { name: "asc" } }),
    prisma.providerCountryConfig.findMany({
      where: {
        provider: {
          code: { not: "MOCK" },
          integrationStatus: { in: ["IMPLEMENTED", "TESTING", "WORKING"] }
        }
      },
      include: { provider: true, country: true },
      orderBy: [{ provider: { name: "asc" } }, { country: { name: "asc" } }]
    })
  ]);

  const matrixRows = await Promise.all(
    configs.map(async (config: (typeof configs)[number]) => {
      const lastRun = await prisma.providerFetchRun.findFirst({
        where: { providerId: config.providerId, countryId: config.countryId },
        orderBy: { startedAt: "desc" }
      });
      const countryWhere = { countryTags: { some: { countryId: config.countryId } } };
      const [observationsToday, observationsThisMonth] = await Promise.all([
        prisma.rawFlightObservation.count({
          where: { providerId: config.providerId, observedAt: { gte: day }, ...countryWhere }
        }),
        prisma.rawFlightObservation.count({
          where: { providerId: config.providerId, observedAt: { gte: month }, ...countryWhere }
        })
      ]);
      const effectiveEnabled = config.provider.enabled && config.country.enabled && config.enabled && config.liveEnabled;
      const disabledReasons = [
        config.provider.enabled ? null : "provider",
        config.country.enabled ? null : "country",
        config.enabled ? null : "config",
        config.liveEnabled ? null : "live"
      ].filter((reason): reason is string => Boolean(reason));

      return {
        id: config.id,
        providerId: config.providerId,
        countryId: config.countryId,
        provider: {
          name: config.provider.name,
          code: config.provider.code,
          enabled: config.provider.enabled,
          integrationStatus: config.provider.integrationStatus
        },
        country: {
          name: config.country.name,
          iso3: config.country.iso3,
          enabled: config.country.enabled
        },
        configEnabled: config.enabled,
        liveEnabled: config.liveEnabled,
        effectiveEnabled,
        disabledReasons,
        lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
        lastRunSuccess: lastRun?.success ?? null,
        lastRunRecords: lastRun?.recordCount ?? null,
        observationsToday,
        observationsThisMonth
      };
    })
  );

  return { today, thisWeek, thisMonth, activeCountries, activeProviders, failedLast24h, openCritical, countries, matrixRows };
});

app.get("/countries", async () => prisma.country.findMany({ include: { collectionAreas: true }, orderBy: { name: "asc" } }));
app.get("/providers", async () => prisma.provider.findMany({ orderBy: { name: "asc" } }));

app.patch("/countries/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ enabled: z.boolean(), priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional() }).parse(request.body);
  return reply.send(await prisma.country.update({ where: { id: params.id }, data: body }));
});

app.patch("/providers/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ enabled: z.boolean() }).parse(request.body);
  return reply.send(await prisma.provider.update({ where: { id: params.id }, data: body }));
});

app.get("/configs", async () =>
  prisma.providerCountryConfig.findMany({
    include: { provider: true, country: true },
    orderBy: [{ country: { name: "asc" } }, { provider: { name: "asc" } }]
  })
);

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  liveEnabled: z.boolean().optional(),
  historicalEnabled: z.boolean().optional(),
  livePollingIntervalSeconds: z.number().int().min(1).optional(),
  liveLatitude: z.number().nullable().optional(),
  liveLongitude: z.number().nullable().optional(),
  liveRadiusNm: z.number().int().nullable().optional(),
  minPollingIntervalSeconds: z.number().int().nullable().optional(),
  maxRequestsPerMinute: z.number().int().nullable().optional(),
  maxRequestsPerHour: z.number().int().nullable().optional(),
  maxRequestsPerDay: z.number().int().nullable().optional(),
  maxCreditsPerDay: z.number().int().nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  lowVolumeThresholdCount: z.number().int().nullable().optional(),
  lowVolumeWindowMinutes: z.number().int().nullable().optional(),
  noDataAlertAfterMinutes: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional()
});

app.patch("/configs/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const data = configUpdateSchema.parse(request.body);
  return reply.send(await prisma.providerCountryConfig.update({ where: { id: params.id }, data }));
});

app.patch("/configs/provider/:providerId", async (request, reply) => {
  const params = z.object({ providerId: z.string() }).parse(request.params);
  const data = configUpdateSchema.parse(request.body);
  const result = await prisma.providerCountryConfig.updateMany({ where: { providerId: params.providerId }, data });
  return reply.send({ updated: result.count });
});

app.get("/country/:id", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const country = await prisma.country.findUnique({ where: { id }, include: { collectionAreas: true, providerCountryConfigs: { include: { provider: true } } } });
  const observations = await prisma.rawFlightObservation.count({ where: { countryTags: { some: { countryId: id } } } });
  const lastObservation = await prisma.rawFlightObservation.findFirst({ where: { countryTags: { some: { countryId: id } } }, orderBy: { observedAt: "desc" } });
  return { country, observations, lastObservation };
});

app.get("/provider/:id", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const provider = await prisma.provider.findUnique({ where: { id }, include: { providerCountryConfigs: { include: { country: true } } } });
  const [runs, failedRuns, lastErrors, requestsToday, failedToday, recordsToday, requestsThisMonth, failedThisMonth, recordsThisMonth, bytesThisMonth] = await Promise.all([
    prisma.providerFetchRun.count({ where: { providerId: id } }),
    prisma.providerFetchRun.count({ where: { providerId: id, success: false } }),
    prisma.providerFetchRun.findMany({ where: { providerId: id, success: false }, orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.providerFetchRun.count({ where: { providerId: id, startedAt: { gte: today } } }),
    prisma.providerFetchRun.count({ where: { providerId: id, success: false, startedAt: { gte: today } } }),
    prisma.providerFetchRun.aggregate({ where: { providerId: id, startedAt: { gte: today } }, _sum: { recordCount: true } }),
    prisma.providerFetchRun.count({ where: { providerId: id, startedAt: { gte: month } } }),
    prisma.providerFetchRun.count({ where: { providerId: id, success: false, startedAt: { gte: month } } }),
    prisma.providerFetchRun.aggregate({ where: { providerId: id, startedAt: { gte: month } }, _sum: { recordCount: true } }),
    prisma.rawProviderResponse.aggregate({ where: { providerId: id, receivedAt: { gte: month } }, _sum: { byteSize: true } })
  ]);
  return {
    provider,
    runs,
    failedRuns,
    successRate: runs === 0 ? null : (runs - failedRuns) / runs,
    lastErrors,
    usage: {
      requestsToday,
      failedToday,
      successfulToday: requestsToday - failedToday,
      recordsToday: recordsToday._sum.recordCount ?? 0,
      requestsThisMonth,
      failedThisMonth,
      successfulThisMonth: requestsThisMonth - failedThisMonth,
      recordsThisMonth: recordsThisMonth._sum.recordCount ?? 0,
      bytesThisMonth: bytesThisMonth._sum.byteSize ?? 0
    }
  };
});

app.get("/raw", async (request) => {
  const query = z
    .object({
      providerId: z.string().optional(),
      countryId: z.string().optional(),
      icao24: z.string().optional(),
      callsign: z.string().optional()
    })
    .parse(request.query);
  return prisma.rawFlightObservation.findMany({
    where: {
      providerId: query.providerId,
      icao24: query.icao24,
      callsign: query.callsign,
      countryTags: query.countryId ? { some: { countryId: query.countryId } } : undefined
    },
    include: { provider: true, fetchRun: true, rawResponse: true, countryTags: { include: { country: true } } },
    orderBy: { observedAt: "desc" },
    take: 100
  });
});

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

app.get("/exports/raw-observations.csv", async (_request, reply) => {
  const rows = await prisma.rawFlightObservation.findMany({
    include: { provider: true, fetchRun: true, countryTags: { include: { country: true } } },
    orderBy: { observedAt: "desc" }
  });
  const header = [
    "observedAt",
    "provider",
    "countries",
    "icao24",
    "callsign",
    "registration",
    "aircraftTypeIcao",
    "providerFlightId",
    "latitude",
    "longitude",
    "altitudeFt",
    "groundSpeedKt",
    "headingDeg",
    "onGround",
    "sourceType",
    "fetchRunId",
    "rawRecordJson"
  ];
  const csv = [
    header.join(","),
    ...rows.map((row: (typeof rows)[number]) =>
      [
        row.observedAt,
        row.provider.name,
        row.countryTags.map((tag: (typeof row.countryTags)[number]) => tag.country.name).join("; "),
        row.icao24,
        row.callsign,
        row.registration,
        row.aircraftTypeIcao,
        row.providerFlightId,
        row.latitude,
        row.longitude,
        row.altitudeFt,
        row.groundSpeedKt,
        row.headingDeg,
        row.onGround,
        row.sourceType,
        row.fetchRunId,
        row.rawRecordJson
      ]
        .map(csvCell)
        .join(",")
    )
  ].join("\r\n");

  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="raw-flight-observations-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(csv);
});

app.get("/alerts", async () =>
  prisma.alertEvent.findMany({
    include: { alertRule: true, provider: true, country: true },
    orderBy: { triggeredAt: "desc" },
    take: 200
  })
);

app.patch("/alerts/:id/acknowledge", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return prisma.alertEvent.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
});

app.patch("/alerts/:id/resolve", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return prisma.alertEvent.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
});

app.get("/system-health", async () => {
  const [heartbeats, failedJobs, alerts] = await Promise.all([
    prisma.collectorHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" } }),
    prisma.providerFetchRun.findMany({ where: { success: false, reviewedAt: null }, orderBy: { startedAt: "desc" }, take: 20, include: { provider: true, country: true } }),
    prisma.alertEvent.findMany({ where: { status: "OPEN" }, orderBy: { triggeredAt: "desc" }, include: { provider: true, country: true } })
  ]);
  return { heartbeats, failedJobs, alerts, database: "reachable", redis: "configured", queue: "collection" };
});

app.patch("/system-health/failed-runs/review", async (_request, reply) => {
  const result = await prisma.providerFetchRun.updateMany({
    where: { success: false, reviewedAt: null },
    data: { reviewedAt: new Date() }
  });
  return reply.send({ reviewed: result.count });
});

app.post("/manual-test-fetch", async (request) => {
  const body = z.object({ providerId: z.string(), countryId: z.string() }).parse(request.body);
  const job = await collectionQueue.add("manual-test-fetch", body, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
  return { queued: true, jobId: job.id };
});

app.post("/historical-backfill", async (request) => {
  const body = z
    .object({
      providerId: z.string(),
      countryId: z.string(),
      collectionAreaId: z.string(),
      from: z.string(),
      to: z.string(),
      chunkSizeHours: z.number().int().min(1).default(24)
    })
    .parse(request.body);
  const job = await collectionQueue.add("historical-backfill", body, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
  return { queued: true, jobId: job.id };
});

app.post("/admin/cleanup/mock-data", async (_request, reply) => {
  const provider = await prisma.provider.findUnique({ where: { code: "MOCK" } });
  if (!provider) return reply.send({ deleted: 0 });

  const result = await prisma.$transaction(async (tx: TransactionClient) => {
    const observations = await tx.rawFlightObservation.findMany({
      where: { providerId: provider.id },
      select: { id: true }
    });
    const observationIds = observations.map((observation: { id: string }) => observation.id);

    const fetchRuns = await tx.providerFetchRun.findMany({
      where: { providerId: provider.id },
      select: { id: true }
    });
    const fetchRunIds = fetchRuns.map((run: { id: string }) => run.id);

    await tx.countryObservationTag.deleteMany({ where: { rawFlightObservationId: { in: observationIds } } });
    await tx.flightObservationLink.deleteMany({ where: { rawFlightObservationId: { in: observationIds } } });
    const deletedObservations = await tx.rawFlightObservation.deleteMany({ where: { id: { in: observationIds } } });
    const deletedResponses = await tx.rawProviderResponse.deleteMany({ where: { providerId: provider.id } });
    const deletedFetchRuns = await tx.providerFetchRun.deleteMany({ where: { id: { in: fetchRunIds } } });
    await tx.alertEvent.deleteMany({ where: { providerId: provider.id } });
    await tx.providerDailyMetric.deleteMany({ where: { providerId: provider.id } });

    return {
      observations: deletedObservations.count,
      rawResponses: deletedResponses.count,
      fetchRuns: deletedFetchRuns.count
    };
  });

  return reply.send(result);
});

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
await app.listen({ port, host });
