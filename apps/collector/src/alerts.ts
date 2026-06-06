import { prisma } from "@flight-data-collector/db";

async function createOrKeepOpen(input: {
  alertRuleId: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  providerId?: string | null;
  countryId?: string | null;
  message: string;
  measuredValue?: number | null;
  thresholdValue?: number | null;
  windowStart: Date;
  windowEnd: Date;
}) {
  const open = await prisma.alertEvent.findFirst({
    where: {
      alertRuleId: input.alertRuleId,
      providerId: input.providerId ?? undefined,
      countryId: input.countryId ?? undefined,
      status: { in: ["OPEN", "ACKNOWLEDGED"] }
    }
  });
  if (open) return open;

  const last = await prisma.alertEvent.findFirst({
    where: { alertRuleId: input.alertRuleId, providerId: input.providerId ?? undefined, countryId: input.countryId ?? undefined },
    include: { alertRule: true },
    orderBy: { triggeredAt: "desc" }
  });
  const cooldownMs = (last?.alertRule.cooldownMinutes ?? 0) * 60 * 1000;
  if (last && Date.now() - last.triggeredAt.getTime() < cooldownMs) return last;

  return prisma.alertEvent.create({
    data: {
      alertRuleId: input.alertRuleId,
      severity: input.severity,
      providerId: input.providerId,
      countryId: input.countryId,
      message: input.message,
      measuredValue: input.measuredValue,
      thresholdValue: input.thresholdValue,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      triggeredAt: new Date()
    }
  });
}

export async function evaluateAlerts(): Promise<void> {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  for (const rule of rules) {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - rule.evaluationWindowMinutes * 60 * 1000);

    if (rule.alertType === "COLLECTOR_HEARTBEAT_MISSING") {
      const staleCount = await prisma.collectorHeartbeat.count({ where: { lastSeenAt: { lt: windowStart } } });
      if (staleCount > 0) {
        await createOrKeepOpen({
          alertRuleId: rule.id,
          severity: rule.severity,
          message: `${staleCount} collector heartbeat record(s) are stale.`,
          measuredValue: staleCount,
          thresholdValue: rule.thresholdValue,
          windowStart,
          windowEnd
        });
      }
    }

    if (rule.alertType === "PROVIDER_NO_DATA" || rule.alertType === "PROVIDER_LOW_VOLUME") {
      const configs = await prisma.providerCountryConfig.findMany({
        where: { enabled: true, liveEnabled: true, providerId: rule.providerId ?? undefined, countryId: rule.countryId ?? undefined },
        include: { provider: true, country: true }
      });
      for (const config of configs) {
        const observations = await prisma.rawFlightObservation.count({
          where: {
            providerId: config.providerId,
            observedAt: { gte: windowStart, lte: windowEnd },
            countryTags: { some: { countryId: config.countryId } }
          }
        });
        const threshold = rule.alertType === "PROVIDER_LOW_VOLUME" ? rule.thresholdValue ?? config.lowVolumeThresholdCount ?? 1 : 0;
        if (rule.alertType === "PROVIDER_NO_DATA" && observations === 0) {
          await createOrKeepOpen({
            alertRuleId: rule.id,
            severity: rule.severity,
            providerId: config.providerId,
            countryId: config.countryId,
            message: `${config.provider.name} has no observations for ${config.country.name} in the last ${rule.evaluationWindowMinutes} minutes.`,
            measuredValue: observations,
            thresholdValue: threshold,
            windowStart,
            windowEnd
          });
        }
        if (rule.alertType === "PROVIDER_LOW_VOLUME" && observations < threshold) {
          await createOrKeepOpen({
            alertRuleId: rule.id,
            severity: rule.severity,
            providerId: config.providerId,
            countryId: config.countryId,
            message: `${config.provider.name} volume for ${config.country.name} is below threshold.`,
            measuredValue: observations,
            thresholdValue: threshold,
            windowStart,
            windowEnd
          });
        }
      }
    }

    if (rule.alertType === "PROVIDER_ERROR_RATE_HIGH") {
      const runs = await prisma.providerFetchRun.findMany({ where: { startedAt: { gte: windowStart, lte: windowEnd }, providerId: rule.providerId ?? undefined, countryId: rule.countryId ?? undefined } });
      if (runs.length > 0) {
        const failureRate = runs.filter((run: { success: boolean }) => !run.success).length / runs.length;
        if (failureRate > (rule.thresholdValue ?? 0.5)) {
          await createOrKeepOpen({
            alertRuleId: rule.id,
            severity: rule.severity,
            providerId: rule.providerId,
            countryId: rule.countryId,
            message: `Provider fetch failure rate is high: ${Math.round(failureRate * 100)}%.`,
            measuredValue: failureRate,
            thresholdValue: rule.thresholdValue,
            windowStart,
            windowEnd
          });
        }
      }
    }
  }
}
