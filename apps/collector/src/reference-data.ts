import { prisma } from "@flight-data-collector/db";
import type { Queue } from "bullmq";

type CsvRow = Record<string, string>;
type SyncSource = "OURAIRPORTS" | "OPENSKY_AIRCRAFT" | "OPENFLIGHTS" | "WIKIDATA";

const sources = {
  ourAirports: "https://raw.githubusercontent.com/davidmegginson/ourairports-data/master/airports.csv",
  openSkyAircraft: "https://opensky-network.org/datasets/metadata/aircraftDatabase.csv",
  openFlightsAirports: "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat",
  openFlightsAirlines: "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat",
  openFlightsRoutes: "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => (value === "\\N" ? "" : value));
}

function parseCsv(text: string, headers?: string[]): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const columnNames = headers ?? parseCsvLine(lines.shift() ?? "");
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(columnNames.map((name, index) => [name, values[index] ?? ""]));
  });
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInt(value: string | undefined): number | null {
  const parsed = toNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function toBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asJson(row: CsvRow): Record<string, string> {
  return JSON.parse(JSON.stringify(row)) as Record<string, string>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function createManyInBatches<T>(items: T[], batchSize: number, createMany: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    await createMany(items.slice(index, index + batchSize));
  }
}

async function syncOurAirports(): Promise<{ seen: number; upserted: number }> {
  const rows = parseCsv(await fetchText(sources.ourAirports));
  await prisma.ourAirportsAirport.deleteMany();
  const data = rows
    .map((row) => ({
      sourceId: toInt(row.id),
      ident: row.ident || null,
      type: row.type || null,
      name: row.name || "",
      latitude: toNumber(row.latitude_deg),
      longitude: toNumber(row.longitude_deg),
      elevationFt: toInt(row.elevation_ft),
      continent: row.continent || null,
      isoCountry: row.iso_country || null,
      isoRegion: row.iso_region || null,
      municipality: row.municipality || null,
      scheduledService: row.scheduled_service || null,
      gpsCode: row.gps_code || null,
      iataCode: row.iata_code || null,
      localCode: row.local_code || null,
      homeLink: row.home_link || null,
      wikipediaLink: row.wikipedia_link || null,
      keywords: row.keywords || null,
      sourceUpdatedAt: toDate(row.updated_at),
      rawCsvJson: asJson(row)
    }))
    .filter((row): row is NonNullable<typeof row> & { sourceId: number } => row.sourceId != null);
  await createManyInBatches(data, 1000, (batch) => prisma.ourAirportsAirport.createMany({ data: batch, skipDuplicates: true }));
  return { seen: rows.length, upserted: data.length };
}

async function syncOpenSkyAircraft(): Promise<{ seen: number; upserted: number }> {
  const rows = parseCsv(await fetchText(sources.openSkyAircraft));
  await prisma.openSkyAircraftRecord.deleteMany();
  const data = rows
    .map((row) => ({
      icao24: (row.icao24 || "").toLowerCase(),
      registration: row.registration || null,
      manufacturerIcao: row.manufacturericao || null,
      manufacturerName: row.manufacturername || null,
      model: row.model || null,
      typecode: row.typecode || null,
      serialNumber: row.serialnumber || null,
      lineNumber: row.linenumber || null,
      icaoAircraftType: row.icaoaircrafttype || null,
      operatorName: row.operator || null,
      operatorCallsign: row.operatorcallsign || null,
      operatorIcao: row.operatoricao || null,
      operatorIata: row.operatoriata || null,
      owner: row.owner || null,
      testReg: row.testreg || null,
      registered: row.registered || null,
      regUntil: row.reguntil || null,
      status: row.status || null,
      built: row.built || null,
      firstFlightDate: row.firstflightdate || null,
      seatConfiguration: row.seatconfiguration || null,
      engines: row.engines || null,
      modes: toBoolean(row.modes),
      adsb: toBoolean(row.adsb),
      acars: toBoolean(row.acars),
      notes: row.notes || null,
      categoryDescription: row.categoryDescription || row.categorydescription || null,
      rawCsvJson: asJson(row)
    }))
    .filter((row) => row.icao24.length > 0);
  await createManyInBatches(data, 1000, (batch) => prisma.openSkyAircraftRecord.createMany({ data: batch, skipDuplicates: true }));
  return { seen: rows.length, upserted: data.length };
}

async function syncOpenFlights(): Promise<{ seen: number; upserted: number }> {
  const [airportRows, airlineRows, routeRows] = await Promise.all([
    fetchText(sources.openFlightsAirports).then((text) =>
      parseCsv(text, ["id", "name", "city", "country", "iata", "icao", "latitude", "longitude", "altitude", "timezone", "dst", "tz", "type", "source"])
    ),
    fetchText(sources.openFlightsAirlines).then((text) =>
      parseCsv(text, ["id", "name", "alias", "iata", "icao", "callsign", "country", "active"])
    ),
    fetchText(sources.openFlightsRoutes).then((text) =>
      parseCsv(text, ["airline", "airlineId", "sourceAirport", "sourceAirportId", "destinationAirport", "destinationAirportId", "codeshare", "stops", "equipment"])
    )
  ]);

  await prisma.openFlightsRoute.deleteMany();
  await prisma.openFlightsAirport.deleteMany();
  await prisma.openFlightsAirline.deleteMany();

  const airports = airportRows
    .map((row) => ({
      sourceId: toInt(row.id),
      name: row.name || null,
      city: row.city || null,
      country: row.country || null,
      iataCode: row.iata || null,
      icaoCode: row.icao || null,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      altitudeFt: toInt(row.altitude),
      timezone: toNumber(row.timezone),
      dst: row.dst || null,
      tzDatabaseName: row.tz || null,
      type: row.type || null,
      source: row.source || null,
      rawCsvJson: asJson(row)
    }))
    .filter((row): row is NonNullable<typeof row> & { sourceId: number } => row.sourceId != null);
  const airlines = airlineRows
    .map((row) => ({
      sourceId: toInt(row.id),
      name: row.name || null,
      alias: row.alias || null,
      iataCode: row.iata || null,
      icaoCode: row.icao || null,
      callsign: row.callsign || null,
      country: row.country || null,
      active: row.active || null,
      rawCsvJson: asJson(row)
    }))
    .filter((row): row is NonNullable<typeof row> & { sourceId: number } => row.sourceId != null);
  const routes = routeRows.map((row) => ({
    sourceAirlineCode: row.airline || null,
    sourceAirlineId: row.airlineId || null,
    sourceAirportCode: row.sourceAirport || null,
    sourceAirportId: row.sourceAirportId || null,
    destinationAirportCode: row.destinationAirport || null,
    destinationAirportId: row.destinationAirportId || null,
    codeshare: row.codeshare || null,
    stops: toInt(row.stops),
    equipment: row.equipment || null,
    rawCsvJson: asJson(row)
  }));

  await createManyInBatches(airports, 1000, (batch) => prisma.openFlightsAirport.createMany({ data: batch, skipDuplicates: true }));
  await createManyInBatches(airlines, 1000, (batch) => prisma.openFlightsAirline.createMany({ data: batch, skipDuplicates: true }));
  await createManyInBatches(routes, 1000, (batch) => prisma.openFlightsRoute.createMany({ data: batch }));
  return { seen: airportRows.length + airlineRows.length + routeRows.length, upserted: airports.length + airlines.length + routes.length };
}

async function syncWikidataPlaceholder(): Promise<{ seen: number; upserted: number }> {
  return { seen: 0, upserted: 0 };
}

export async function syncReferenceData(source: SyncSource): Promise<void> {
  const startedAt = new Date();
  const run = await prisma.referenceDataSyncRun.create({ data: { source, status: "RUNNING", startedAt } });
  try {
    const result =
      source === "OURAIRPORTS"
        ? await syncOurAirports()
        : source === "OPENSKY_AIRCRAFT"
          ? await syncOpenSkyAircraft()
          : source === "OPENFLIGHTS"
            ? await syncOpenFlights()
            : await syncWikidataPlaceholder();
    const finishedAt = new Date();
    await prisma.referenceDataSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        recordsSeen: result.seen,
        recordsUpserted: result.upserted
      }
    });
  } catch (error) {
    const finishedAt = new Date();
    await prisma.referenceDataSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
}

export async function enqueueDueReferenceDataSyncs(queue: Pick<Queue, "add">): Promise<void> {
  const now = new Date();
  const weekday = now.getDay();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const configs = await prisma.referenceDataSyncConfig.findMany({ where: { enabled: true } });
  for (const config of configs) {
    const enabledToday = [config.sunday, config.monday, config.tuesday, config.wednesday, config.thursday, config.friday, config.saturday][weekday];
    if (!enabledToday || config.timeOfDayLocal !== current) continue;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const existing = await prisma.referenceDataSyncRun.findFirst({
      where: { source: config.source, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" }
    });
    if (existing) continue;
    await queue.add("reference-data-sync", { source: config.source }, { attempts: 2, backoff: { type: "exponential", delay: 5000 } });
  }
}
