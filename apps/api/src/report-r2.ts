import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "@flight-data-collector/db";

type JsonInput = string | number | boolean | JsonInput[] | { [key: string]: JsonInput };

type R2Observation = {
  observedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  headingDeg: number | null;
};

type R2Enrichment = {
  status: string;
  source: string;
  queryKey: string;
  requestedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  selectedCandidate: JsonInput | null;
  candidateCount: number;
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
  enrichment: R2Enrichment | null;
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

const googleFlightsSource = "GOOGLE_FLIGHTS_RAPIDAPI" as const;

function parseDateWindow(date: string): { start: Date; end: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function toJsonValue(value: unknown): JsonInput {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonInput;
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
}

function parseCallsign(callsign: string | null | undefined): { prefix: string; flightNumber: string } | null {
  const normalized = normalizeCode(callsign);
  if (!normalized) return null;
  const match = normalized.match(/^([A-Z]{2,3})(\d{1,5}[A-Z]?)$/);
  if (!match) return null;
  return { prefix: match[1], flightNumber: match[2] };
}

async function toIataAirportCode(code: string | null): Promise<string | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  if (normalized.length === 3) return normalized;
  if (normalized.length !== 4) return null;

  const airport = await prisma.ourAirportsAirport.findFirst({
    where: { OR: [{ ident: normalized }, { gpsCode: normalized }] },
    select: { iataCode: true }
  });
  if (airport?.iataCode) return normalizeCode(airport.iataCode);

  const openFlightsAirport = await prisma.openFlightsAirport.findFirst({
    where: { icaoCode: normalized },
    select: { iataCode: true }
  });
  return normalizeCode(openFlightsAirport?.iataCode);
}

async function toIataAirlineCode(prefix: string | null, observedIata: string | null): Promise<string | null> {
  const normalizedIata = normalizeCode(observedIata);
  if (normalizedIata?.length === 2) return normalizedIata;
  const normalizedPrefix = normalizeCode(prefix);
  if (!normalizedPrefix) return null;
  if (normalizedPrefix.length === 2) return normalizedPrefix;

  const airline = await prisma.openFlightsAirline.findFirst({
    where: { icaoCode: normalizedPrefix },
    select: { iataCode: true }
  });
  return normalizeCode(airline?.iataCode);
}

function extractArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const data = object.data;
  if (data && typeof data === "object") {
    const dataObject = data as Record<string, unknown>;
    for (const key of ["topFlights", "otherFlights", "flights", "results"]) {
      if (Array.isArray(dataObject[key])) return dataObject[key] as unknown[];
    }
  }
  for (const key of ["topFlights", "otherFlights", "flights", "results"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueAsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueAsBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function collectFlightNumbers(candidate: unknown): string[] {
  const result = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const airlineCode = valueAsString(object.airlineCode);
    const flightNumber = valueAsString(object.flightNumber);
    if (airlineCode && flightNumber) result.add(`${airlineCode.toUpperCase()}${flightNumber.toUpperCase()}`);
    for (const nested of Object.values(object)) walk(nested);
  };
  walk(candidate);
  return [...result];
}

function pickSelectedCandidate(candidates: unknown[], airlineCode: string | null, flightNumber: string | null): unknown | null {
  if (candidates.length === 0) return null;
  if (!airlineCode || !flightNumber) return candidates[0];
  const expected = `${airlineCode}${flightNumber}`.toUpperCase();
  return candidates.find((candidate) => collectFlightNumbers(candidate).some((number) => number === expected)) ?? candidates[0];
}

function candidateSummary(candidate: unknown, rank: number): {
  rank: number;
  price: number | null;
  airlineCode: string | null;
  airlineNamesJson: JsonInput;
  departureAirportCode: string | null;
  departureAirportName: string | null;
  arrivalAirportCode: string | null;
  arrivalAirportName: string | null;
  departureDate: string | null;
  departureTime: string | null;
  arrivalDate: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  stops: number | null;
  aircraftName: string | null;
  flightNumbersJson: JsonInput;
  detailToken: string | null;
  isAvailable: boolean | null;
  rawCandidateJson: JsonInput;
} {
  const object = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
  const firstSegment = Array.isArray(object.segments) && object.segments[0] && typeof object.segments[0] === "object"
    ? (object.segments[0] as Record<string, unknown>)
    : object;
  return {
    rank,
    price: valueAsNumber(object.price),
    airlineCode: valueAsString(object.airlineCode),
    airlineNamesJson: toJsonValue(object.airlineNames ?? object.airline ?? []),
    departureAirportCode: valueAsString(object.departureAirportCode) ?? valueAsString(firstSegment.departureAirportCode),
    departureAirportName: valueAsString(firstSegment.departureAirportName),
    arrivalAirportCode: valueAsString(object.arrivalAirportCode) ?? valueAsString(firstSegment.arrivalAirportCode),
    arrivalAirportName: valueAsString(firstSegment.arrivalAirportName),
    departureDate: valueAsString(object.departureDate) ?? valueAsString(firstSegment.departureDate),
    departureTime: valueAsString(object.departureTime) ?? valueAsString(firstSegment.departureTime),
    arrivalDate: valueAsString(object.arrivalDate) ?? valueAsString(firstSegment.arrivalDate),
    arrivalTime: valueAsString(object.arrivalTime) ?? valueAsString(firstSegment.arrivalTime),
    durationMinutes: valueAsNumber(object.duration) ?? valueAsNumber(firstSegment.durationMinutes),
    stops: valueAsNumber(object.stops),
    aircraftName: valueAsString(firstSegment.aircraftName),
    flightNumbersJson: toJsonValue(collectFlightNumbers(candidate)),
    detailToken: valueAsString(object.detailToken),
    isAvailable: valueAsBoolean(object.isAvailable),
    rawCandidateJson: toJsonValue(candidate)
  };
}

type EnrichmentInput = {
  detectedFlightId: string;
  reportDate: Date;
  date: string;
  callsign: string | null;
  observedAirlineIata: string | null;
  observedAirlineIcao: string | null;
  originAirportCode: string | null;
  destinationAirportCode: string | null;
};

async function enrichWithGoogleFlights(input: EnrichmentInput): Promise<R2Enrichment | null> {
  const parsed = parseCallsign(input.callsign);
  const parsedAirlineCode = await toIataAirlineCode(parsed?.prefix ?? input.observedAirlineIcao, input.observedAirlineIata);
  const parsedFlightNumber = parsed?.flightNumber ?? null;
  const originAirportCode = await toIataAirportCode(input.originAirportCode);
  const destinationAirportCode = await toIataAirportCode(input.destinationAirportCode);
  const outboundDate = input.date;
  const canQueryGoogleFlights = Boolean(parsedFlightNumber && originAirportCode && destinationAirportCode);
  const baseQueryKey = [
    googleFlightsSource,
    outboundDate,
    parsedAirlineCode ?? "NOAIRLINE",
    parsedFlightNumber ?? "NOFLIGHT",
    originAirportCode ?? "NOORIGIN",
    destinationAirportCode ?? "NODEST"
  ].join(":");
  const queryKey = canQueryGoogleFlights ? baseQueryKey : `${baseQueryKey}:${input.detectedFlightId}`;

  const existing = await prisma.flightEnrichmentQuery.findUnique({
    where: { queryKey },
    include: { candidates: { orderBy: { rank: "asc" }, take: 5 } }
  });
  if (existing) {
    return {
      status: existing.status,
      source: existing.source,
      queryKey: existing.queryKey,
      requestedAt: existing.requestedAt?.toISOString() ?? null,
      completedAt: existing.completedAt?.toISOString() ?? null,
      errorMessage: existing.errorMessage,
      selectedCandidate: (existing.selectedCandidateJson as JsonInput | null) ?? null,
      candidateCount: existing.candidateCount
    };
  }

  const endpoint = process.env.GOOGLE_FLIGHTS_SEARCH_ONE_WAY_ENDPOINT ?? "/flights/search-one-way";
  const requestParams = {
    departureId: originAirportCode,
    arrivalId: destinationAirportCode,
    departureDate: outboundDate,
    adults: "1",
    currency: process.env.GOOGLE_FLIGHTS_CURRENCY ?? "USD",
    languageCode: process.env.GOOGLE_FLIGHTS_LANGUAGE_CODE ?? "en",
    countryCode: process.env.GOOGLE_FLIGHTS_COUNTRY_CODE ?? "US",
    flightNumber: parsedAirlineCode && parsedFlightNumber ? `${parsedAirlineCode}${parsedFlightNumber}` : null
  };

  if (!canQueryGoogleFlights) {
    const created = await prisma.flightEnrichmentQuery.create({
      data: {
        detectedFlightId: input.detectedFlightId,
        source: googleFlightsSource,
        status: "NO_QUERY_POSSIBLE",
        queryKey,
        reportDate: input.reportDate,
        callsign: input.callsign,
        parsedAirlineCode,
        parsedFlightNumber,
        originAirportCode,
        destinationAirportCode,
        outboundDate,
        endpoint,
        requestParamsJson: toJsonValue(requestParams),
        completedAt: new Date(),
        notes: "Google Flights enrichment requires a parsed flight number and origin/destination airport codes."
      }
    });
    return {
      status: created.status,
      source: created.source,
      queryKey: created.queryKey,
      requestedAt: null,
      completedAt: created.completedAt?.toISOString() ?? null,
      errorMessage: created.errorMessage,
      selectedCandidate: null,
      candidateCount: 0
    };
  }

  const apiKey = process.env.GOOGLE_FLIGHTS_RAPIDAPI_KEY ?? process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    const created = await prisma.flightEnrichmentQuery.create({
      data: {
        detectedFlightId: input.detectedFlightId,
        source: googleFlightsSource,
        status: "FAILED",
        queryKey,
        reportDate: input.reportDate,
        callsign: input.callsign,
        parsedAirlineCode,
        parsedFlightNumber,
        originAirportCode,
        destinationAirportCode,
        outboundDate,
        endpoint,
        requestParamsJson: toJsonValue(requestParams),
        completedAt: new Date(),
        errorMessage: "GOOGLE_FLIGHTS_RAPIDAPI_KEY or RAPIDAPI_KEY is not configured."
      }
    });
    return {
      status: created.status,
      source: created.source,
      queryKey: created.queryKey,
      requestedAt: null,
      completedAt: created.completedAt?.toISOString() ?? null,
      errorMessage: created.errorMessage,
      selectedCandidate: null,
      candidateCount: 0
    };
  }

  const host = process.env.GOOGLE_FLIGHTS_RAPIDAPI_HOST ?? "google-flights4.p.rapidapi.com";
  const url = new URL(`https://${host}${endpoint}`);
  Object.entries(requestParams).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });

  const started = new Date();
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey
      }
    });
    const bodyText = await response.text();
    const rawResponse = bodyText.trim() ? JSON.parse(bodyText) as unknown : { emptyBody: true };
    const candidates = extractArrayPayload(rawResponse);
    const selected = pickSelectedCandidate(candidates, parsedAirlineCode, parsedFlightNumber);
    const status = response.ok ? (candidates.length > 0 ? "SUCCESS" : "NO_MATCH") : "FAILED";
    const created = await prisma.flightEnrichmentQuery.create({
      data: {
        detectedFlightId: input.detectedFlightId,
        source: googleFlightsSource,
        status,
        queryKey,
        reportDate: input.reportDate,
        callsign: input.callsign,
        parsedAirlineCode,
        parsedFlightNumber,
        originAirportCode,
        destinationAirportCode,
        outboundDate,
        endpoint,
        requestParamsJson: toJsonValue(requestParams),
        requestedAt: started,
        completedAt: new Date(),
        httpStatus: response.status,
        errorMessage: response.ok ? null : `Google Flights request failed with HTTP ${response.status} ${response.statusText}.`,
        rawResponseJson: toJsonValue(rawResponse),
        selectedCandidateJson: selected == null ? undefined : toJsonValue(selected),
        candidateCount: candidates.length,
        candidates: {
          create: candidates.slice(0, 10).map((candidate, index) => candidateSummary(candidate, index + 1))
        }
      }
    });
    return {
      status: created.status,
      source: created.source,
      queryKey: created.queryKey,
      requestedAt: created.requestedAt?.toISOString() ?? null,
      completedAt: created.completedAt?.toISOString() ?? null,
      errorMessage: created.errorMessage,
      selectedCandidate: (created.selectedCandidateJson as JsonInput | null) ?? null,
      candidateCount: created.candidateCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const created = await prisma.flightEnrichmentQuery.create({
      data: {
        detectedFlightId: input.detectedFlightId,
        source: googleFlightsSource,
        status: "FAILED",
        queryKey,
        reportDate: input.reportDate,
        callsign: input.callsign,
        parsedAirlineCode,
        parsedFlightNumber,
        originAirportCode,
        destinationAirportCode,
        outboundDate,
        endpoint,
        requestParamsJson: toJsonValue(requestParams),
        requestedAt: started,
        completedAt: new Date(),
        errorMessage: message
      }
    });
    return {
      status: created.status,
      source: created.source,
      queryKey: created.queryKey,
      requestedAt: created.requestedAt?.toISOString() ?? null,
      completedAt: created.completedAt?.toISOString() ?? null,
      errorMessage: created.errorMessage,
      selectedCandidate: null,
      candidateCount: 0
    };
  }
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values.map(normalizeCode).find((value): value is string => Boolean(value)) ?? null;
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

  const maxEnrichmentRequests = Number(process.env.GOOGLE_FLIGHTS_MAX_REQUESTS_PER_REPORT ?? 15);
  let createdRequests = 0;
  const flights: R2Flight[] = [];
  for (const flightCountry of flightCountries) {
    const flight = flightCountry.detectedFlight;
    const observations = flight.observations;
    const observedOriginAirportCode = firstNonEmpty(observations.map((observation) => observation.originAirportIcao));
    const observedDestinationAirportCode = firstNonEmpty(observations.map((observation) => observation.destinationAirportIcao));
    const observedAirlineIata = firstNonEmpty(observations.map((observation) => observation.airlineIata));
    const observedAirlineIcao = firstNonEmpty(observations.map((observation) => observation.airlineIcao));

    let enrichment: R2Enrichment | null = null;
    if (shouldEnrich) {
      const parsed = parseCallsign(flight.callsign);
      const likelyPossible = Boolean(parsed && observedOriginAirportCode && observedDestinationAirportCode);
      if (!likelyPossible || createdRequests < maxEnrichmentRequests) {
        enrichment = await enrichWithGoogleFlights({
          detectedFlightId: flight.id,
          reportDate: start,
          date,
          callsign: flight.callsign,
          observedAirlineIata,
          observedAirlineIcao,
          originAirportCode: observedOriginAirportCode,
          destinationAirportCode: observedDestinationAirportCode
        });
        if (enrichment?.requestedAt) createdRequests += 1;
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
      "Google Flights data is used only as commercial itinerary enrichment, never as observed position evidence.",
      "Google Flights enrichment is requested only for report flights with enough usable identity and route information.",
      "Every Google Flights enrichment attempt is persisted and reused by query key to reduce repeated API spend.",
      "If enrichment is missing or failed, the observed flight remains valid as provider evidence but has no itinerary candidate.",
      "Provider data remains separated; no cross-provider deduplication is performed in this report."
    ]
  };
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
    lines.push("");
    lines.push(`${index + 1}. ${flight.callsign ?? "Unknown callsign"} | ICAO24 ${flight.icao24 ?? "-"} | Aircraft ${flight.aircraftTypeIcao ?? "-"}`);
    lines.push(`Observed: ${flight.firstObservedAt} to ${flight.lastObservedAt} | points ${flight.observationCount}`);
    lines.push(`Observed route fields: ${flight.observedOriginAirportCode ?? "-"} -> ${flight.observedDestinationAirportCode ?? "-"}`);
    lines.push(`Google Flights enrichment: ${flight.enrichment?.status ?? "NOT_REQUESTED"} | candidates ${flight.enrichment?.candidateCount ?? 0}`);
    if (flight.enrichment?.errorMessage) lines.push(`Enrichment error: ${flight.enrichment.errorMessage}`);
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
    ["First observed", "Last observed", "Callsign", "ICAO24", "Registration", "Aircraft type", "Observed route", "Points", "Enrichment status", "Candidates"]
  ];
  const observationRows: Array<Array<string | number>> = [["Flight callsign", "Observed at", "Latitude", "Longitude", "Altitude ft", "Ground speed kt", "Heading deg"]];
  report.flights.forEach((flight) => {
    flightRows.push([
      flight.firstObservedAt,
      flight.lastObservedAt,
      flight.callsign ?? "",
      flight.icao24 ?? "",
      flight.registration ?? "",
      flight.aircraftTypeIcao ?? "",
      `${flight.observedOriginAirportCode ?? ""} -> ${flight.observedDestinationAirportCode ?? ""}`,
      flight.observationCount,
      flight.enrichment?.status ?? "NOT_REQUESTED",
      flight.enrichment?.candidateCount ?? 0
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
