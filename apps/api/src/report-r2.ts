import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "@flight-data-collector/db";
import { enrichFlightWithAdb, type AdbEnrichment } from "./aerodatabox.js";

type R2Observation = {
  observedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  headingDeg: number | null;
};

type R2Flight = {
  id: string;
  callsign: string | null;
  providerFlightId: string | null;
  icao24: string | null;
  registration: string | null;
  aircraftTypeIcao: string | null;
  operatorName: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  observedOriginAirportCode: string | null;
  observedDestinationAirportCode: string | null;
  observedAirlineIata: string | null;
  observedAirlineIcao: string | null;
  enrichment: AdbEnrichment | null;
  observations: R2Observation[];
};

export type R2Report = {
  reportCode: "R2";
  title: string;
  provider: { id: string; code: string; name: string };
  country: { id: string; iso3: string; name: string };
  date: string;
  windowStart: string;
  windowEnd: string;
  hourlyDataPoints: number[];
  hourlyFlights: number[];
  totalDataPoints: number;
  totalFlights: number;
  flights: R2Flight[];
  generatedAt: string;
  assumptions: string[];
};

const reportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  providerId: z.string().min(1),
  countryId: z.string().min(1),
  enrich: z.enum(["true", "false"]).optional()
});

function parseDateWindow(date: string): { start: Date; end: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values.map(normalizeCode).find((value): value is string => Boolean(value)) ?? null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// An airline-style ATC callsign (3-letter ICAO airline + flight number) is the minimum
// needed to attempt an AeroDataBox lookup. Registrations / tactical / numeric callsigns
// (e.g. N891EA, CONGO03C, 01234567) cannot be enriched and must not spend API budget.
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d{1,4}[A-Z]?$/;

function isEnrichableCallsign(callsign: string | null): boolean {
  const normalized = normalizeCode(callsign);
  return Boolean(normalized && AIRLINE_CALLSIGN.test(normalized));
}

export async function buildR2Report(query: unknown): Promise<R2Report> {
  const { date, providerId, countryId, enrich } = reportQuerySchema.parse(query);
  const shouldEnrich = enrich !== "false";
  const { start, end } = parseDateWindow(date);
  const [provider, country, taggedObservations, flightCountries] = await Promise.all([
    prisma.provider.findUnique({ where: { id: providerId } }),
    prisma.country.findUnique({ where: { id: countryId } }),
    prisma.rawFlightObservation.findMany({
      where: {
        providerId,
        observedAt: { gte: start, lt: end },
        countryTags: { some: { countryId } }
      },
      orderBy: { observedAt: "asc" }
    }),
    prisma.providerDetectedFlightCountry.findMany({
      where: {
        countryId,
        firstObservedAt: { gte: start, lt: end },
        detectedFlight: { providerId }
      },
      include: {
        detectedFlight: {
          include: {
            observations: {
              where: {
                observedAt: { gte: start, lt: end },
                countryTags: { some: { countryId } }
              },
              orderBy: { observedAt: "asc" }
            }
          }
        }
      },
      orderBy: { firstObservedAt: "asc" }
    })
  ]);

  if (!provider) throw new Error("Provider not found");
  if (!country) throw new Error("Country not found");

  const hourlyDataPoints = Array.from({ length: 24 }, () => 0);
  for (const observation of taggedObservations) {
    hourlyDataPoints[observation.observedAt.getUTCHours()] += 1;
  }

  const hourlyFlights = Array.from({ length: 24 }, () => 0);
  for (const flightCountry of flightCountries) {
    hourlyFlights[flightCountry.firstObservedAt.getUTCHours()] += 1;
  }

  const maxEnrichmentRequests = Number(process.env.AERODATABOX_MAX_REQUESTS_PER_REPORT ?? 40);
  let networkCalls = 0;
  const flights: R2Flight[] = [];
  for (const flightCountry of flightCountries) {
    const flight = flightCountry.detectedFlight;
    const observations = flight.observations;
    const observedOriginAirportCode = firstNonEmpty(observations.map((observation) => observation.originAirportIcao));
    const observedDestinationAirportCode = firstNonEmpty(observations.map((observation) => observation.destinationAirportIcao));
    const observedAirlineIata = firstNonEmpty(observations.map((observation) => observation.airlineIata));
    const observedAirlineIcao = firstNonEmpty(observations.map((observation) => observation.airlineIcao));

    let enrichment: AdbEnrichment | null = null;
    if (shouldEnrich && isEnrichableCallsign(flight.callsign)) {
      const result = await enrichFlightWithAdb({
        callsign: flight.callsign,
        date,
        detectedFlightId: flight.id,
        allowNetwork: networkCalls < maxEnrichmentRequests
      });
      enrichment = result.enrichment;
      if (result.networkCalls > 0) {
        networkCalls += result.networkCalls;
        // Gentle pacing: pause briefly every five live ADB calls.
        if (networkCalls % 5 === 0 && networkCalls < maxEnrichmentRequests) {
          await sleep(500);
        }
      }
    }

    flights.push({
      id: flight.id,
      callsign: flight.callsign,
      providerFlightId: flight.providerFlightId,
      icao24: flight.icao24,
      registration: flight.registration,
      aircraftTypeIcao: flight.aircraftTypeIcao,
      operatorName: flight.operatorName,
      firstObservedAt: flightCountry.firstObservedAt.toISOString(),
      lastObservedAt: flightCountry.lastObservedAt.toISOString(),
      observationCount: observations.length,
      observedOriginAirportCode,
      observedDestinationAirportCode,
      observedAirlineIata,
      observedAirlineIcao,
      enrichment,
      observations: observations.map((observation) => ({
        observedAt: observation.observedAt.toISOString(),
        latitude: observation.latitude,
        longitude: observation.longitude,
        altitudeFt: observation.altitudeFt,
        groundSpeedKt: observation.groundSpeedKt,
        headingDeg: observation.headingDeg
      }))
    });
  }

  return {
    reportCode: "R2",
    title: "R2 - One Day Detail, One Country",
    provider: { id: provider.id, code: provider.code, name: provider.name },
    country: { id: country.id, iso3: country.iso3, name: country.name },
    date,
    windowStart: start.toISOString(),
    windowEnd: new Date(end.getTime() - 1).toISOString(),
    hourlyDataPoints,
    hourlyFlights,
    totalDataPoints: taggedObservations.length,
    totalFlights: flightCountries.length,
    flights,
    generatedAt: new Date().toISOString(),
    assumptions: [
      "The report covers exactly one UTC day from 00:00:00.000 to 23:59:59.999.",
      "Only one provider and one country are selected for each R2 report run.",
      "Data point counts are based on raw observations tagged to the selected country.",
      "Flight counts are based on provider-separated ProviderDetectedFlight records.",
      "A flight is counted in the hour when it first appears in the selected country's monitored airspace.",
      "Route and schedule enrichment comes from AeroDataBox (ADB), resolved by ATC callsign first and derived IATA flight number as fallback.",
      "ADB enrichment is only attempted for airline-style callsigns; registrations, tactical, and numeric callsigns are reported as NO_QUERY_POSSIBLE.",
      "Every ADB lookup is cached by identity and date in AdbFlightLookup and reused across reports to reduce API spend; historical days are never re-fetched.",
      "ADB live lookups per report are capped by AERODATABOX_MAX_REQUESTS_PER_REPORT; cache hits do not count against the cap.",
      "ADB schedule data is enrichment context only and never overrides observed position evidence; observed flights without an ADB match remain valid.",
      "Provider data remains separated; no cross-provider deduplication is performed in this report."
    ]
  };
}

function enrichmentRoute(enrichment: AdbEnrichment | null): string {
  if (!enrichment) return "-";
  const origin = enrichment.origin?.iata ?? enrichment.origin?.icao ?? "?";
  const destination = enrichment.destination?.iata ?? enrichment.destination?.icao ?? "?";
  if (!enrichment.origin && !enrichment.destination) return enrichment.status;
  return `${origin} -> ${destination}`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pdfEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\n", " ");
}

function pdfLine(text: string, x: number, y: number, size = 9): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(text.slice(0, 150))}) Tj ET\n`;
}

function paginateLines(lines: string[], title: string): string[] {
  const pages: string[] = [];
  let current = "";
  let y = 548;
  const newPage = () => {
    if (current) pages.push(current);
    current = pdfLine(title, 44, 568, 14);
    y = 542;
  };
  newPage();
  for (const line of lines) {
    if (y < 42) newPage();
    current += pdfLine(line, 44, y, 8);
    y -= 13;
  }
  if (current) pages.push(current);
  return pages;
}

function buildPdfFromPages(pageContents: string[]): Buffer {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageContents.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pageContents.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pageContents.forEach((content, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function buildR2Pdf(report: R2Report): Buffer {
  const lines = [
    `${report.title}`,
    `Provider: ${report.provider.name} (${report.provider.code})`,
    `Country: ${report.country.name} (${report.country.iso3})`,
    `Date UTC: ${report.date}`,
    `Window: ${report.windowStart} to ${report.windowEnd}`,
    `Total data points: ${report.totalDataPoints}`,
    `Total detected flights: ${report.totalFlights}`,
    "",
    "Hourly summary",
    "Hour UTC | Data points | Detected flights",
    ...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00 | ${report.hourlyDataPoints[hour]} | ${report.hourlyFlights[hour]}`),
    "",
    "Flight details"
  ];
  report.flights.forEach((flight, index) => {
    const enrichment = flight.enrichment;
    lines.push("");
    lines.push(`${index + 1}. ${flight.callsign ?? "Unknown callsign"} | ICAO24 ${flight.icao24 ?? "-"} | Aircraft ${flight.aircraftTypeIcao ?? "-"}`);
    lines.push(`Observed: ${flight.firstObservedAt} to ${flight.lastObservedAt} | points ${flight.observationCount}`);
    lines.push(`ADB enrichment: ${enrichment?.status ?? "NOT_REQUESTED"} | flight ${enrichment?.matchedNumber ?? "-"} | route ${enrichmentRoute(enrichment)}`);
    if (enrichment?.airline?.name || enrichment?.aircraftModel) {
      lines.push(`Airline ${enrichment?.airline?.name ?? "-"} | Aircraft ${enrichment?.aircraftModel ?? "-"} | status ${enrichment?.flightStatus ?? "-"}`);
    }
    if (enrichment?.origin?.scheduledUtc || enrichment?.destination?.scheduledUtc) {
      lines.push(`Sched dep ${enrichment?.origin?.scheduledUtc ?? "-"} | sched arr ${enrichment?.destination?.scheduledUtc ?? "-"}`);
    }
    if (enrichment?.errorMessage) lines.push(`Enrichment error: ${enrichment.errorMessage}`);
    lines.push("Locations:");
    flight.observations.forEach((observation) => {
      lines.push(`  ${observation.observedAt} | lat ${observation.latitude.toFixed(5)} lon ${observation.longitude.toFixed(5)} alt ${observation.altitudeFt ?? "-"}`);
    });
  });
  lines.push("");
  lines.push("Appendix - Assumptions and Decisions");
  report.assumptions.forEach((assumption, index) => lines.push(`${index + 1}. ${assumption}`));
  return buildPdfFromPages(paginateLines(lines, report.title));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

function worksheetXml(rows: Array<Array<string | number>>): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildR2Xlsx(report: R2Report): Buffer {
  const summaryRows: Array<Array<string | number>> = [
    ["Report", report.title],
    ["Provider", `${report.provider.name} (${report.provider.code})`],
    ["Country", `${report.country.name} (${report.country.iso3})`],
    ["Date UTC", report.date],
    ["Total data points", report.totalDataPoints],
    ["Total flights", report.totalFlights],
    [],
    ["Hour UTC", "Data points", "Detected flights"],
    ...Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, "0")}:00`, report.hourlyDataPoints[hour], report.hourlyFlights[hour]])
  ];
  const flightRows: Array<Array<string | number>> = [
    [
      "First observed",
      "Last observed",
      "Callsign",
      "ICAO24",
      "Aircraft type",
      "ADB status",
      "ADB flight",
      "ADB route",
      "ADB airline",
      "ADB aircraft",
      "Sched dep UTC",
      "Sched arr UTC",
      "Points"
    ]
  ];
  const observationRows: Array<Array<string | number>> = [["Flight callsign", "Observed at", "Latitude", "Longitude", "Altitude ft", "Ground speed kt", "Heading deg"]];
  report.flights.forEach((flight) => {
    const enrichment = flight.enrichment;
    flightRows.push([
      flight.firstObservedAt,
      flight.lastObservedAt,
      flight.callsign ?? "",
      flight.icao24 ?? "",
      flight.aircraftTypeIcao ?? "",
      enrichment?.status ?? "NOT_REQUESTED",
      enrichment?.matchedNumber ?? "",
      enrichment && (enrichment.origin || enrichment.destination) ? enrichmentRoute(enrichment) : "",
      enrichment?.airline?.name ?? "",
      enrichment?.aircraftModel ?? "",
      enrichment?.origin?.scheduledUtc ?? "",
      enrichment?.destination?.scheduledUtc ?? "",
      flight.observationCount
    ]);
    flight.observations.forEach((observation) => {
      observationRows.push([
        flight.callsign ?? "",
        observation.observedAt,
        observation.latitude,
        observation.longitude,
        observation.altitudeFt ?? "",
        observation.groundSpeedKt ?? "",
        observation.headingDeg ?? ""
      ]);
    });
  });
  const appendixRows: Array<Array<string | number>> = [["Appendix - Assumptions and Decisions"], ["Generated at", report.generatedAt], []];
  report.assumptions.forEach((assumption, index) => appendixRows.push([index + 1, assumption]));

  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Flights" sheetId="2" r:id="rId2"/><sheet name="Observations" sheetId="3" r:id="rId3"/><sheet name="Appendix" sheetId="4" r:id="rId4"/></sheets></workbook>'
    },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(summaryRows) },
    { name: "xl/worksheets/sheet2.xml", content: worksheetXml(flightRows) },
    { name: "xl/worksheets/sheet3.xml", content: worksheetXml(observationRows) },
    { name: "xl/worksheets/sheet4.xml", content: worksheetXml(appendixRows) }
  ]);
}

export function sendReportFile(reply: FastifyReply, body: Buffer, contentType: string, filename: string): FastifyReply {
  return reply.header("Content-Type", contentType).header("Content-Disposition", `attachment; filename="${filename}"`).send(body);
}
