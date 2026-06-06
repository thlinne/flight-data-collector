import { createHash } from "node:crypto";
import type { ProviderFetchResult } from "@flight-data-collector/core";
import { isPointInBoundingBox } from "@flight-data-collector/core";
import { prisma } from "@flight-data-collector/db";
import type { TransactionClient } from "@flight-data-collector/db";

type JsonInput = string | number | boolean | JsonInput[] | { [key: string]: JsonInput };
type FlightGrouping = {
  method: "PROVIDER_FLIGHT_ID" | "ICAO24_CALLSIGN" | "ICAO24";
  key: string;
};

const flightContinuationGapMs = 3 * 60 * 60 * 1000;

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function toJsonValue(value: unknown): JsonInput {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonInput;
}

function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function identityKey(record: ProviderFetchResult["records"][number]): string | null {
  const parts = [
    normalizeIdentityPart(record.icao24),
    normalizeIdentityPart(record.callsign),
    normalizeIdentityPart(record.registration),
    normalizeIdentityPart(record.aircraftTypeIcao),
    normalizeIdentityPart(record.operatorName)
  ];
  if (parts.every((part) => part.length === 0)) return null;
  return parts.join("|");
}

async function storeObservedIdentity(tx: TransactionClient, providerId: string, record: ProviderFetchResult["records"][number]): Promise<void> {
  const key = identityKey(record);
  if (!key) return;
  const existing = await tx.observedAircraftIdentity.findUnique({
    where: { providerId_identityKey: { providerId, identityKey: key } }
  });
  if (existing) {
    await tx.observedAircraftIdentity.update({
      where: { id: existing.id },
      data: {
        lastObservedAt: record.observedAt,
        observationCount: { increment: 1 },
        rawExamplesJson: toJsonValue(record.rawRecord)
      }
    });
    return;
  }
  await tx.observedAircraftIdentity.create({
    data: {
      providerId,
      identityKey: key,
      icao24: record.icao24,
      callsign: record.callsign,
      registration: record.registration,
      aircraftType: record.aircraftTypeIcao,
      operatorName: record.operatorName,
      firstObservedAt: record.observedAt,
      lastObservedAt: record.observedAt,
      rawExamplesJson: toJsonValue(record.rawRecord)
    }
  });
}

function normalizeFlightPart(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function flightGrouping(record: ProviderFetchResult["records"][number]): FlightGrouping | null {
  const providerFlightId = normalizeFlightPart(record.providerFlightId);
  if (providerFlightId) return { method: "PROVIDER_FLIGHT_ID", key: `providerFlightId:${providerFlightId}` };

  const icao24 = normalizeFlightPart(record.icao24);
  const callsign = normalizeFlightPart(record.callsign);
  if (icao24 && callsign) return { method: "ICAO24_CALLSIGN", key: `icao24-callsign:${icao24}:${callsign}` };
  if (icao24) return { method: "ICAO24", key: `icao24:${icao24}` };
  return null;
}

async function findOrCreateDetectedFlight(tx: TransactionClient, providerId: string, record: ProviderFetchResult["records"][number]): Promise<string | null> {
  const grouping = flightGrouping(record);
  if (!grouping) return null;

  const latest = await tx.providerDetectedFlight.findFirst({
    where: { providerId, groupingKey: grouping.key },
    orderBy: { lastObservedAt: "desc" }
  });
  const shouldContinue =
    latest != null &&
    (grouping.method === "PROVIDER_FLIGHT_ID" || record.observedAt.getTime() - latest.lastObservedAt.getTime() <= flightContinuationGapMs);

  if (latest && shouldContinue) {
    await tx.providerDetectedFlight.update({
      where: { id: latest.id },
      data: {
        providerFlightId: record.providerFlightId ?? latest.providerFlightId,
        icao24: record.icao24 ?? latest.icao24,
        callsign: record.callsign ?? latest.callsign,
        registration: record.registration ?? latest.registration,
        aircraftTypeIcao: record.aircraftTypeIcao ?? latest.aircraftTypeIcao,
        operatorName: record.operatorName ?? latest.operatorName,
        firstObservedAt: record.observedAt < latest.firstObservedAt ? record.observedAt : latest.firstObservedAt,
        lastObservedAt: record.observedAt > latest.lastObservedAt ? record.observedAt : latest.lastObservedAt,
        observationCount: { increment: 1 }
      }
    });
    return latest.id;
  }

  const created = await tx.providerDetectedFlight.create({
    data: {
      providerId,
      groupingMethod: grouping.method,
      groupingKey: grouping.key,
      flightKey: `${grouping.key}:${record.observedAt.toISOString()}`,
      providerFlightId: record.providerFlightId,
      icao24: record.icao24,
      callsign: record.callsign,
      registration: record.registration,
      aircraftTypeIcao: record.aircraftTypeIcao,
      operatorName: record.operatorName,
      firstObservedAt: record.observedAt,
      lastObservedAt: record.observedAt,
      observationCount: 1
    }
  });
  return created.id;
}

async function tagDetectedFlightCountry(tx: TransactionClient, detectedFlightId: string | null, countryId: string, observedAt: Date): Promise<void> {
  if (!detectedFlightId) return;
  const existing = await tx.providerDetectedFlightCountry.findUnique({
    where: { detectedFlightId_countryId: { detectedFlightId, countryId } }
  });
  if (existing) {
    await tx.providerDetectedFlightCountry.update({
      where: { id: existing.id },
      data: {
        firstObservedAt: observedAt < existing.firstObservedAt ? observedAt : existing.firstObservedAt,
        lastObservedAt: observedAt > existing.lastObservedAt ? observedAt : existing.lastObservedAt,
        observationCount: { increment: 1 }
      }
    });
    return;
  }
  await tx.providerDetectedFlightCountry.create({
    data: {
      detectedFlightId,
      countryId,
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      observationCount: 1
    }
  });
}

export async function storeFetchResult(input: {
  providerId: string;
  countryId: string;
  collectionAreaId: string;
  mode: "LIVE" | "HISTORICAL" | "MANUAL_TEST";
  startedAt: Date;
  result: ProviderFetchResult;
}) {
  const finishedAt = new Date();
  const payloadHash = hashPayload(input.result.rawPayload);
  return prisma.$transaction(async (tx: TransactionClient) => {
    const fetchRun = await tx.providerFetchRun.create({
      data: {
        providerId: input.providerId,
        countryId: input.countryId,
        collectionAreaId: input.collectionAreaId,
        mode: input.mode,
        endpoint: input.result.endpoint,
        requestParamsJson: toJsonValue(input.result.requestParams),
        startedAt: input.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - input.startedAt.getTime(),
        httpStatus: 200,
        success: true,
        responseHash: payloadHash,
        recordCount: input.result.records.length
      }
    });

    const rawResponse = await tx.rawProviderResponse.create({
      data: {
        providerId: input.providerId,
        fetchRunId: fetchRun.id,
        receivedAt: input.result.receivedAt,
        contentType: "application/json",
        payloadJson: toJsonValue(input.result.rawPayload),
        payloadHash,
        byteSize: Buffer.byteLength(JSON.stringify(input.result.rawPayload))
      }
    });

    const area = await tx.collectionArea.findUniqueOrThrow({ where: { id: input.collectionAreaId } });
    for (const record of input.result.records) {
      await storeObservedIdentity(tx, input.providerId, record);
      const detectedFlightId = await findOrCreateDetectedFlight(tx, input.providerId, record);
      const observation = await tx.rawFlightObservation.create({
        data: {
          providerId: input.providerId,
          fetchRunId: fetchRun.id,
          rawResponseId: rawResponse.id,
          detectedFlightId,
          observedAt: record.observedAt,
          providerAircraftId: record.providerAircraftId,
          providerFlightId: record.providerFlightId,
          icao24: record.icao24,
          callsign: record.callsign,
          registration: record.registration,
          aircraftTypeIcao: record.aircraftTypeIcao,
          operatorName: record.operatorName,
          airlineIcao: record.airlineIcao,
          airlineIata: record.airlineIata,
          originAirportIcao: record.originAirportIcao,
          destinationAirportIcao: record.destinationAirportIcao,
          latitude: record.latitude,
          longitude: record.longitude,
          altitudeFt: record.altitudeFt,
          groundSpeedKt: record.groundSpeedKt,
          headingDeg: record.headingDeg,
          verticalRateFpm: record.verticalRateFpm,
          squawk: record.squawk,
          onGround: record.onGround,
          sourceType: record.sourceType,
          rawRecordJson: toJsonValue(record.rawRecord)
        }
      });

      const inBbox =
        area.bboxNorth != null &&
        area.bboxSouth != null &&
        area.bboxEast != null &&
        area.bboxWest != null &&
        isPointInBoundingBox(record.latitude, record.longitude, {
          north: area.bboxNorth,
          south: area.bboxSouth,
          east: area.bboxEast,
          west: area.bboxWest
        });

      if (inBbox) {
        await tx.countryObservationTag.create({
          data: {
            rawFlightObservationId: observation.id,
            countryId: input.countryId,
            collectionAreaId: input.collectionAreaId,
            tagMethod: "BBOX",
            confidenceScore: 0.75
          }
        });
        await tagDetectedFlightCountry(tx, detectedFlightId, input.countryId, record.observedAt);
      }
    }

    await tx.rawProviderResponse.update({ where: { id: rawResponse.id }, data: { flightProcessedAt: new Date() } });
    return { fetchRun, rawResponse };
  });
}

export async function storeFailedFetchRun(input: {
  providerId: string;
  countryId: string;
  collectionAreaId?: string;
  mode: "LIVE" | "HISTORICAL" | "MANUAL_TEST";
  endpoint: string;
  requestParamsJson: Record<string, unknown>;
  startedAt: Date;
  error: unknown;
}) {
  const finishedAt = new Date();
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  return prisma.providerFetchRun.create({
    data: {
      providerId: input.providerId,
      countryId: input.countryId,
      collectionAreaId: input.collectionAreaId,
      mode: input.mode,
      endpoint: input.endpoint,
      requestParamsJson: toJsonValue(input.requestParamsJson),
      startedAt: input.startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - input.startedAt.getTime(),
      success: false,
      errorCode: error.name,
      errorMessage: error.message,
      recordCount: 0
    }
  });
}
