import { prisma } from "@flight-data-collector/db";

// AeroDataBox (ADB) flight-route enrichment for R2.
//
// FRP observations carry only a callsign (ATC) and an FR24 numeric id — no route.
// ADB resolves callsign / flight number + date into origin/destination airports,
// scheduled+predicted times, airline and aircraft model. Results are cached in
// AdbFlightLookup, keyed by (queryKind:queryValue:queryDate), and reused across every
// detected flight that shares the same identity and date (historical days never change).
//
// Lookup order per decision: ATC callsign first, then derived IATA flight number.

type JsonInput = string | number | boolean | JsonInput[] | { [key: string]: JsonInput };
type UnknownRecord = Record<string, unknown>;

const AIRLINE_CALLSIGN = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/;

export type AdbRoutePoint = {
  icao: string | null;
  iata: string | null;
  name: string | null;
  country: string | null;
  scheduledUtc: string | null;
  predictedUtc: string | null;
};

export type AdbEnrichmentStatus = "SUCCESS" | "NO_MATCH" | "NO_QUERY_POSSIBLE" | "FAILED" | "NOT_REQUESTED";

export type AdbEnrichment = {
  source: "AERODATABOX";
  status: AdbEnrichmentStatus;
  queryKind: "CALLSIGN" | "NUMBER" | null;
  queryValue: string | null;
  queryDate: string;
  lookupKey: string | null;
  reusedFromCache: boolean;
  candidateCount: number;
  matchedNumber: string | null;
  airline: { name: string | null; iata: string | null; icao: string | null } | null;
  origin: AdbRoutePoint | null;
  destination: AdbRoutePoint | null;
  aircraftModel: string | null;
  flightStatus: string | null;
  isCargo: boolean | null;
  greatCircleKm: number | null;
  errorMessage: string | null;
};

function toJsonValue(value: unknown): JsonInput {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonInput;
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
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

// ADB times look like "2026-06-11 06:35Z" -> a valid Date.
function parseAdbUtc(value: unknown): Date | null {
  const text = valueAsString(value);
  if (!text) return null;
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function adbUtcDatePart(value: unknown): string | null {
  const text = valueAsString(value);
  return text ? text.slice(0, 10) : null;
}

async function icaoAirlineToIata(icao: string): Promise<string | null> {
  const airline = await prisma.openFlightsAirline.findFirst({
    where: { icaoCode: icao },
    select: { iataCode: true }
  });
  return normalizeCode(airline?.iataCode);
}

type LookupPlan = { kind: "CALLSIGN" | "NUMBER"; value: string };

async function buildLookupPlans(callsign: string | null): Promise<LookupPlan[]> {
  const plans: LookupPlan[] = [];
  const cs = normalizeCode(callsign);
  if (!cs) return plans;
  const match = cs.match(AIRLINE_CALLSIGN);
  if (!match) return plans; // not an airline-style callsign (registration / tactical / numeric)
  plans.push({ kind: "CALLSIGN", value: cs });
  const iata = await icaoAirlineToIata(match[1]);
  if (iata) plans.push({ kind: "NUMBER", value: `${iata}${match[2]}` });
  return plans;
}

type NormalizedFlight = {
  matchedNumber: string | null;
  airlineName: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureIcao: string | null;
  departureIata: string | null;
  departureName: string | null;
  departureCountry: string | null;
  departureScheduledUtc: Date | null;
  arrivalIcao: string | null;
  arrivalIata: string | null;
  arrivalName: string | null;
  arrivalCountry: string | null;
  arrivalScheduledUtc: Date | null;
  arrivalPredictedUtc: Date | null;
  aircraftModel: string | null;
  flightStatus: string | null;
  codeshareStatus: string | null;
  isCargo: boolean | null;
  greatCircleKm: number | null;
  lastUpdatedUtc: Date | null;
};

function normalizeFlight(raw: unknown): NormalizedFlight | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as UnknownRecord;
  const departure = (record.departure as UnknownRecord | undefined) ?? {};
  const arrival = (record.arrival as UnknownRecord | undefined) ?? {};
  const depAirport = (departure.airport as UnknownRecord | undefined) ?? {};
  const arrAirport = (arrival.airport as UnknownRecord | undefined) ?? {};
  const depScheduled = departure.scheduledTime as UnknownRecord | undefined;
  const arrScheduled = arrival.scheduledTime as UnknownRecord | undefined;
  const arrPredicted = arrival.predictedTime as UnknownRecord | undefined;
  const airline = (record.airline as UnknownRecord | undefined) ?? {};
  const aircraft = (record.aircraft as UnknownRecord | undefined) ?? {};
  const distance = (record.greatCircleDistance as UnknownRecord | undefined) ?? {};

  return {
    matchedNumber: valueAsString(record.number)?.replace(/\s+/g, "") ?? null,
    airlineName: valueAsString(airline.name),
    airlineIata: normalizeCode(valueAsString(airline.iata)),
    airlineIcao: normalizeCode(valueAsString(airline.icao)),
    departureIcao: normalizeCode(valueAsString(depAirport.icao)),
    departureIata: normalizeCode(valueAsString(depAirport.iata)),
    departureName: valueAsString(depAirport.name),
    departureCountry: normalizeCode(valueAsString(depAirport.countryCode)),
    departureScheduledUtc: parseAdbUtc(depScheduled?.utc),
    arrivalIcao: normalizeCode(valueAsString(arrAirport.icao)),
    arrivalIata: normalizeCode(valueAsString(arrAirport.iata)),
    arrivalName: valueAsString(arrAirport.name),
    arrivalCountry: normalizeCode(valueAsString(arrAirport.countryCode)),
    arrivalScheduledUtc: parseAdbUtc(arrScheduled?.utc),
    arrivalPredictedUtc: parseAdbUtc(arrPredicted?.utc),
    aircraftModel: valueAsString(aircraft.model),
    flightStatus: valueAsString(record.status),
    codeshareStatus: valueAsString(record.codeshareStatus),
    isCargo: valueAsBoolean(record.isCargo),
    greatCircleKm: valueAsNumber(distance.km),
    lastUpdatedUtc: parseAdbUtc(record.lastUpdatedUtc)
  };
}

function extractFlightArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as UnknownRecord;
  for (const key of ["flights", "data", "result"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

// Pick the flight whose departure happens on the report date; fall back to the first.
function selectBestFlight(flights: unknown[], date: string): unknown | null {
  if (flights.length === 0) return null;
  const sameDay = flights.find((flight) => {
    const departure = (flight as UnknownRecord).departure as UnknownRecord | undefined;
    const scheduled = departure?.scheduledTime as UnknownRecord | undefined;
    return adbUtcDatePart(scheduled?.utc) === date;
  });
  return sameDay ?? flights[0];
}

type AdbRow = Awaited<ReturnType<typeof prisma.adbFlightLookup.findUnique>>;

function rowToEnrichment(row: NonNullable<AdbRow>, reusedFromCache: boolean): AdbEnrichment {
  const hasOrigin = Boolean(row.departureIata || row.departureIcao);
  const hasDestination = Boolean(row.arrivalIata || row.arrivalIcao);
  return {
    source: "AERODATABOX",
    status: row.status as AdbEnrichmentStatus,
    queryKind: row.queryKind as "CALLSIGN" | "NUMBER",
    queryValue: row.queryValue,
    queryDate: row.queryDate,
    lookupKey: row.lookupKey,
    reusedFromCache,
    candidateCount: row.candidateCount,
    matchedNumber: row.matchedNumber,
    airline:
      row.airlineName || row.airlineIata || row.airlineIcao
        ? { name: row.airlineName, iata: row.airlineIata, icao: row.airlineIcao }
        : null,
    origin: hasOrigin
      ? {
          icao: row.departureIcao,
          iata: row.departureIata,
          name: row.departureName,
          country: row.departureCountry,
          scheduledUtc: row.departureScheduledUtc?.toISOString() ?? null,
          predictedUtc: null
        }
      : null,
    destination: hasDestination
      ? {
          icao: row.arrivalIcao,
          iata: row.arrivalIata,
          name: row.arrivalName,
          country: row.arrivalCountry,
          scheduledUtc: row.arrivalScheduledUtc?.toISOString() ?? null,
          predictedUtc: row.arrivalPredictedUtc?.toISOString() ?? null
        }
      : null,
    aircraftModel: row.aircraftModel,
    flightStatus: row.flightStatus,
    isCargo: row.isCargo,
    greatCircleKm: row.greatCircleKm,
    errorMessage: row.errorMessage
  };
}

async function callAdb(
  plan: LookupPlan,
  date: string
): Promise<{ httpStatus: number | null; flights: unknown[]; raw: unknown; endpoint: string; error: string | null }> {
  const host = process.env.AERODATABOX_RAPIDAPI_HOST ?? "aerodatabox.p.rapidapi.com";
  const apiKey = process.env.AERODATABOX_RAPIDAPI_KEY ?? process.env.RAPIDAPI_KEY;
  const segment = plan.kind === "CALLSIGN" ? "callsign" : "number";
  const endpoint = `/flights/${segment}/${plan.value}/${date}`;
  if (!apiKey) {
    return { httpStatus: null, flights: [], raw: null, endpoint, error: "AERODATABOX_RAPIDAPI_KEY or RAPIDAPI_KEY is not configured." };
  }
  const url = `https://${host}${endpoint}`;
  const response = await fetch(url, {
    headers: { "x-rapidapi-host": host, "x-rapidapi-key": apiKey }
  });
  const bodyText = await response.text();
  let raw: unknown = bodyText.trim() ? JSON.parse(bodyText) : null;
  if (!response.ok && response.status !== 204) {
    return { httpStatus: response.status, flights: [], raw, endpoint, error: `AeroDataBox request failed with HTTP ${response.status} ${response.statusText}.` };
  }
  const flights = extractFlightArray(raw);
  return { httpStatus: response.status, flights, raw, endpoint, error: null };
}

async function persistLookup(input: {
  lookupKey: string;
  plan: LookupPlan;
  date: string;
  status: string;
  endpoint: string;
  httpStatus: number | null;
  requestedAt: Date;
  errorMessage: string | null;
  candidateCount: number;
  selected: NormalizedFlight | null;
  selectedRaw: unknown;
  raw: unknown;
  firstDetectedFlightId: string | null;
}): Promise<NonNullable<AdbRow>> {
  const data = {
    lookupKey: input.lookupKey,
    queryKind: input.plan.kind,
    queryValue: input.plan.value,
    queryDate: input.date,
    status: input.status as never,
    source: "AERODATABOX" as never,
    firstDetectedFlightId: input.firstDetectedFlightId,
    endpoint: input.endpoint,
    httpStatus: input.httpStatus ?? undefined,
    requestedAt: input.requestedAt,
    completedAt: new Date(),
    errorMessage: input.errorMessage,
    candidateCount: input.candidateCount,
    matchedNumber: input.selected?.matchedNumber ?? null,
    airlineName: input.selected?.airlineName ?? null,
    airlineIata: input.selected?.airlineIata ?? null,
    airlineIcao: input.selected?.airlineIcao ?? null,
    departureIcao: input.selected?.departureIcao ?? null,
    departureIata: input.selected?.departureIata ?? null,
    departureName: input.selected?.departureName ?? null,
    departureCountry: input.selected?.departureCountry ?? null,
    departureScheduledUtc: input.selected?.departureScheduledUtc ?? null,
    arrivalIcao: input.selected?.arrivalIcao ?? null,
    arrivalIata: input.selected?.arrivalIata ?? null,
    arrivalName: input.selected?.arrivalName ?? null,
    arrivalCountry: input.selected?.arrivalCountry ?? null,
    arrivalScheduledUtc: input.selected?.arrivalScheduledUtc ?? null,
    arrivalPredictedUtc: input.selected?.arrivalPredictedUtc ?? null,
    aircraftModel: input.selected?.aircraftModel ?? null,
    flightStatus: input.selected?.flightStatus ?? null,
    codeshareStatus: input.selected?.codeshareStatus ?? null,
    isCargo: input.selected?.isCargo ?? null,
    greatCircleKm: input.selected?.greatCircleKm ?? null,
    lastUpdatedUtc: input.selected?.lastUpdatedUtc ?? null,
    selectedCandidateJson: input.selectedRaw == null ? undefined : toJsonValue(input.selectedRaw),
    rawResponseJson: input.raw == null ? undefined : toJsonValue(input.raw)
  };
  try {
    return await prisma.adbFlightLookup.create({ data });
  } catch (error) {
    // Concurrent report runs may race on the unique lookupKey; reuse the winner.
    const existing = await prisma.adbFlightLookup.findUnique({ where: { lookupKey: input.lookupKey } });
    if (existing) return existing;
    throw error;
  }
}

function notRequested(date: string): AdbEnrichment {
  return {
    source: "AERODATABOX",
    status: "NOT_REQUESTED",
    queryKind: null,
    queryValue: null,
    queryDate: date,
    lookupKey: null,
    reusedFromCache: false,
    candidateCount: 0,
    matchedNumber: null,
    airline: null,
    origin: null,
    destination: null,
    aircraftModel: null,
    flightStatus: null,
    isCargo: null,
    greatCircleKm: null,
    errorMessage: null
  };
}

function noQueryPossible(date: string): AdbEnrichment {
  return { ...notRequested(date), status: "NO_QUERY_POSSIBLE" };
}

export async function enrichFlightWithAdb(input: {
  callsign: string | null;
  date: string;
  detectedFlightId?: string | null;
  allowNetwork: boolean;
}): Promise<{ enrichment: AdbEnrichment; networkCalls: number }> {
  const plans = await buildLookupPlans(input.callsign);
  if (plans.length === 0) {
    return { enrichment: noQueryPossible(input.date), networkCalls: 0 };
  }

  let networkCalls = 0;
  let lastNonSuccess: AdbEnrichment | null = null;

  for (const plan of plans) {
    const lookupKey = `${plan.kind}:${plan.value}:${input.date}`;
    const existing = await prisma.adbFlightLookup.findUnique({ where: { lookupKey } });
    if (existing) {
      if (existing.status === "SUCCESS") return { enrichment: rowToEnrichment(existing, true), networkCalls };
      lastNonSuccess = rowToEnrichment(existing, true);
      continue; // cached non-success: do not re-call this key, try next plan
    }
    if (!input.allowNetwork) {
      continue; // budget exhausted and not cached
    }

    const requestedAt = new Date();
    const { httpStatus, flights, raw, endpoint, error } = await callAdb(plan, input.date);
    networkCalls += 1;
    const selectedRaw = error ? null : selectBestFlight(flights, input.date);
    const selected = selectedRaw ? normalizeFlight(selectedRaw) : null;
    const hasRoute = Boolean(selected && (selected.departureIata || selected.departureIcao) && (selected.arrivalIata || selected.arrivalIcao));
    const status = error ? "FAILED" : hasRoute ? "SUCCESS" : "NO_MATCH";

    const row = await persistLookup({
      lookupKey,
      plan,
      date: input.date,
      status,
      endpoint,
      httpStatus,
      requestedAt,
      errorMessage: error,
      candidateCount: flights.length,
      selected,
      selectedRaw,
      raw,
      firstDetectedFlightId: input.detectedFlightId ?? null
    });

    if (row.status === "SUCCESS") return { enrichment: rowToEnrichment(row, false), networkCalls };
    lastNonSuccess = rowToEnrichment(row, false);
  }

  return { enrichment: lastNonSuccess ?? notRequested(input.date), networkCalls };
}
