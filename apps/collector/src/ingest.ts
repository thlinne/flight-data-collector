import { createHash } from "node:crypto";
import type { ProviderFetchResult } from "@flight-data-collector/core";
import { isPointInBoundingBox } from "@flight-data-collector/core";
import { prisma } from "@flight-data-collector/db";
import type { TransactionClient } from "@flight-data-collector/db";

type JsonInput = string | number | boolean | JsonInput[] | { [key: string]: JsonInput };

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function toJsonValue(value: unknown): JsonInput {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonInput;
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
      const observation = await tx.rawFlightObservation.create({
        data: {
          providerId: input.providerId,
          fetchRunId: fetchRun.id,
          rawResponseId: rawResponse.id,
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
      }
    }

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
