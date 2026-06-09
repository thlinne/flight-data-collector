import { spawn } from "node:child_process";
import cors from "@fastify/cors";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "@flight-data-collector/db";
import { buildR1Pdf, buildR1Report, buildR1Xlsx, sendReportFile as sendR1ReportFile } from "./report-r1.js";
import { buildR2Pdf, buildR2Report, buildR2Xlsx, sendReportFile as sendR2ReportFile } from "./report-r2.js";

const app = Fastify({ logger: true });
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null
};
const collectionQueue = new Queue("collection", { connection: redisConnection });
const activeProviderCodes = ["PLANE_FINDER", "RAPID_ADSBEXCHANGE", "RAPID_FLIGHT_RADAR", "RAPID_SKYLINK"];

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
  const yesterday = new Date(day.getTime() - 24 * 60 * 60 * 1000);
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, thisWeek, thisMonth, activeCountries, activeProviders, failedLast24h, openCritical] = await Promise.all([
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: day } } }),
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: week } } }),
    prisma.rawFlightObservation.count({ where: { observedAt: { gte: month } } }),
    prisma.country.count({ where: { enabled: true } }),
    prisma.provider.count({ where: { enabled: true, code: { in: activeProviderCodes } } }),
    prisma.providerFetchRun.count({ where: { success: false, startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    prisma.alertEvent.count({ where: { status: "OPEN", severity: "CRITICAL" } })
  ]);
  const [countries, configs] = await Promise.all([
    prisma.country.findMany({ orderBy: { name: "asc" } }),
    prisma.providerCountryConfig.findMany({
      where: {
        provider: {
          code: { in: activeProviderCodes },
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
      const [observationsYesterday, observationsToday, observationsThisMonth, flightsYesterday, flightsToday, flightsThisMonth, lastRunFlights] = await Promise.all([
        prisma.rawFlightObservation.count({
          where: { providerId: config.providerId, observedAt: { gte: yesterday, lt: day }, ...countryWhere }
        }),
        prisma.rawFlightObservation.count({
          where: { providerId: config.providerId, observedAt: { gte: day }, ...countryWhere }
        }),
        prisma.rawFlightObservation.count({
          where: { providerId: config.providerId, observedAt: { gte: month }, ...countryWhere }
        }),
        prisma.providerDetectedFlightCountry.count({
          where: {
            countryId: config.countryId,
            lastObservedAt: { gte: yesterday, lt: day },
            detectedFlight: { providerId: config.providerId }
          }
        }),
        prisma.providerDetectedFlightCountry.count({
          where: {
            countryId: config.countryId,
            lastObservedAt: { gte: day },
            detectedFlight: { providerId: config.providerId }
          }
        }),
        prisma.providerDetectedFlightCountry.count({
          where: {
            countryId: config.countryId,
            lastObservedAt: { gte: month },
            detectedFlight: { providerId: config.providerId }
          }
        }),
        lastRun
          ? prisma.rawFlightObservation
              .findMany({
                where: {
                  providerId: config.providerId,
                  fetchRunId: lastRun.id,
                  detectedFlightId: { not: null },
                  ...countryWhere
                },
                select: { detectedFlightId: true },
                distinct: ["detectedFlightId"]
              })
              .then((rows: Array<{ detectedFlightId: string | null }>) => rows.length)
          : Promise.resolve(null)
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
        lastRunFlights,
        observationsYesterday,
        observationsToday,
        observationsThisMonth,
        flightsYesterday,
        flightsToday,
        flightsThisMonth
      };
    })
  );

  return { today, thisWeek, thisMonth, activeCountries, activeProviders, failedLast24h, openCritical, countries, matrixRows };
});

app.get("/reports/r1", async (request) => buildR1Report(request.query));

app.get("/reports/r1.pdf", async (request, reply) => {
  const report = await buildR1Report(request.query);
  return sendR1ReportFile(reply, buildR1Pdf(report), "application/pdf", `r1-one-day-overview-${report.provider.code}-${report.date}.pdf`);
});

app.get("/reports/r1.xlsx", async (request, reply) => {
  const report = await buildR1Report(request.query);
  return sendR1ReportFile(
    reply,
    buildR1Xlsx(report),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `r1-one-day-overview-${report.provider.code}-${report.date}.xlsx`
  );
});

app.get("/reports/r2", async (request) => buildR2Report(request.query));

app.get("/reports/r2.pdf", async (request, reply) => {
  const report = await buildR2Report(request.query);
  return sendR2ReportFile(reply, buildR2Pdf(report), "application/pdf", `r2-one-day-detail-${report.provider.code}-${report.country.iso3}-${report.date}.pdf`);
});

app.get("/reports/r2.xlsx", async (request, reply) => {
  const report = await buildR2Report(request.query);
  return sendR2ReportFile(
    reply,
    buildR2Xlsx(report),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `r2-one-day-detail-${report.provider.code}-${report.country.iso3}-${report.date}.xlsx`
  );
});

app.get("/countries", async () => prisma.country.findMany({ include: { collectionAreas: true }, orderBy: { name: "asc" } }));
app.get("/providers", async () =>
  prisma.provider.findMany({
    where: { code: { in: activeProviderCodes } },
    orderBy: { name: "asc" }
  })
);

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
    where: { provider: { code: { in: activeProviderCodes } } },
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

const referenceDataSourceSchema = z.enum(["OURAIRPORTS", "OPENSKY_AIRCRAFT", "OPENFLIGHTS", "WIKIDATA"]);
const referenceDataConfigUpdateSchema = z.object({
  enabled: z.boolean(),
  monday: z.boolean(),
  tuesday: z.boolean(),
  wednesday: z.boolean(),
  thursday: z.boolean(),
  friday: z.boolean(),
  saturday: z.boolean(),
  sunday: z.boolean(),
  timeOfDayLocal: z.string().regex(/^\d{2}:\d{2}$/)
});

app.patch("/configs/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const data = configUpdateSchema.parse(request.body);
  return reply.send(await prisma.providerCountryConfig.update({ where: { id: params.id }, data }));
});

app.get("/reference-data", async () => {
  const [configs, recentRuns, counts] = await Promise.all([
    prisma.referenceDataSyncConfig.findMany({ orderBy: { source: "asc" } }),
    prisma.referenceDataSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 40 }),
    Promise.all([
      prisma.ourAirportsAirport.count(),
      prisma.openSkyAircraftRecord.count(),
      prisma.openFlightsAirport.count(),
      prisma.openFlightsAirline.count(),
      prisma.openFlightsRoute.count(),
      prisma.wikidataEntityPlaceholder.count(),
      prisma.observedAircraftIdentity.count()
    ])
  ]);
  return {
    configs,
    recentRuns,
    counts: {
      ourAirportsAirports: counts[0],
      openSkyAircraft: counts[1],
      openFlightsAirports: counts[2],
      openFlightsAirlines: counts[3],
      openFlightsRoutes: counts[4],
      wikidataEntities: counts[5],
      observedProviderIdentities: counts[6]
    }
  };
});

app.patch("/reference-data/configs/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const data = referenceDataConfigUpdateSchema.parse(request.body);
  return reply.send(await prisma.referenceDataSyncConfig.update({ where: { id: params.id }, data }));
});

app.post("/reference-data/sync", async (request) => {
  const body = z.object({ source: referenceDataSourceSchema }).parse(request.body);
  const job = await collectionQueue.add("reference-data-sync", body, { attempts: 2, backoff: { type: "exponential", delay: 5000 } });
  return { queued: true, jobId: job.id };
});

app.patch("/configs/provider/:providerId", async (request, reply) => {
  const params = z.object({ providerId: z.string() }).parse(request.params);
  const data = configUpdateSchema.parse(request.body);
  const result = await prisma.providerCountryConfig.updateMany({ where: { providerId: params.providerId }, data });
  return reply.send({ updated: result.count });
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

app.post("/system-health/rebuild-detected-flights", async () => {
  const job = await collectionQueue.add("rebuild-detected-flights", {}, { attempts: 1 });
  return { queued: true, jobId: job.id };
});

app.get("/admin/database-backup.sql", async (_request, reply) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return reply.code(500).send({ error: "DATABASE_URL is not configured" });
  }

  const parsedUrl = new URL(databaseUrl);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");
  const schema = parsedUrl.searchParams.get("schema");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `flight_data_collector_${timestamp}.sql`;
  const args = [
    "--no-owner",
    "--no-privileges",
    "-h",
    parsedUrl.hostname,
    "-p",
    parsedUrl.port || "5432",
    "-U",
    decodeURIComponent(parsedUrl.username),
    "-d",
    databaseName
  ];
  if (schema) {
    args.push("-n", schema);
  }

  const dump = spawn("pg_dump", args, {
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsedUrl.password)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const errors: Buffer[] = [];
  let errorBytes = 0;
  let completed = false;
  dump.stderr.on("data", (chunk: Buffer) => {
    if (errorBytes < 64 * 1024) {
      errors.push(chunk);
      errorBytes += chunk.length;
    }
  });

  dump.on("error", (error) => {
    dump.stdout.destroy(error);
  });
  dump.on("close", (exitCode) => {
    completed = true;
    if (exitCode !== 0) {
      const errorText = Buffer.concat(errors).toString("utf8").trim();
      app.log.error({ exitCode, errorText }, "pg_dump backup stream failed");
    }
  });
  reply.raw.on("close", () => {
    if (!completed) dump.kill("SIGTERM");
  });

  const firstChunk = await new Promise<Buffer | null>((resolve, reject) => {
    dump.stdout.once("data", (chunk: Buffer) => resolve(chunk));
    dump.stdout.once("end", () => resolve(null));
    dump.stdout.once("error", reject);
    dump.once("error", reject);
  });

  if (!firstChunk) {
    const errorText = Buffer.concat(errors).toString("utf8").trim();
    return reply.code(500).send({
      error: errorText || "pg_dump produced an empty backup"
    });
  }

  dump.stdout.unshift(firstChunk);
  return reply
    .header("Content-Type", "application/sql; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(dump.stdout);
});

app.post("/manual-test-fetch", async (request) => {
  const body = z.object({ providerId: z.string(), countryId: z.string() }).parse(request.body);
  const job = await collectionQueue.add("manual-test-fetch", body, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
  return { queued: true, jobId: job.id };
});

app.post("/historical-snapshot", async (request) => {
  const body = z
    .object({
      providerId: z.string(),
      countryId: z.string(),
      collectionAreaId: z.string().optional(),
      timestamp: z.string().datetime()
    })
    .parse(request.body);
  const job = await collectionQueue.add("historical-snapshot", body, { attempts: 1 });
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

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
await app.listen({ port, host });
