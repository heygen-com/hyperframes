import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";

export const LOW_USAGE_REMAINING_PERCENT = 20;
const firstCutMessage = (percent: number) =>
  `You have about ${percent}% usage left; I'll make a first watchable cut before polishing.`;

const windowSchema = {
  nullable: true,
  properties: { utilization: { type: "float64" } },
  optionalProperties: { resets_at: { type: "string", nullable: true } },
  additionalProperties: true,
} as const;
const usageSchema = {
  properties: { five_hour: windowSchema, seven_day: windowSchema },
  additionalProperties: true,
} as const;
const parseUsage = new Ajv().compileParser<JTDDataType<typeof usageSchema>>(usageSchema);

type UsageWindow = { remainingPercent: number; resetsAt: string | null };
export type HarnessUsage =
  | { status: "unknown"; reason: string; plan: "standard"; message: null }
  | ({
      status: "known";
      harness: "claude-code";
      session: UsageWindow;
      weekly: UsageWindow;
      remainingPercent: number;
    } & ({ plan: "standard"; message: null } | { plan: "first-cut-first"; message: string }));

export const unknownUsage = (reason: string): HarnessUsage => ({
  status: "unknown",
  reason,
  plan: "standard",
  message: null,
});

export function parseHarnessUsage(text: string): HarnessUsage {
  const usage = parseUsage(text);
  if (!usage || usage.five_hour === null || usage.seven_day === null) {
    return unknownUsage("invalid_usage_response");
  }
  for (const window of [usage.five_hour, usage.seven_day]) {
    if (
      !Number.isFinite(window.utilization) ||
      window.utilization < 0 ||
      window.utilization > 100
    ) {
      return unknownUsage("invalid_usage_response");
    }
  }
  const session = {
    remainingPercent: 100 - usage.five_hour.utilization,
    resetsAt: usage.five_hour.resets_at ?? null,
  };
  const weekly = {
    remainingPercent: 100 - usage.seven_day.utilization,
    resetsAt: usage.seven_day.resets_at ?? null,
  };
  const remainingPercent = Math.min(session.remainingPercent, weekly.remainingPercent);
  const low = remainingPercent <= LOW_USAGE_REMAINING_PERCENT;
  const budget = {
    status: "known",
    harness: "claude-code",
    session,
    weekly,
    remainingPercent,
  } as const;
  return low
    ? { ...budget, plan: "first-cut-first", message: firstCutMessage(Math.floor(remainingPercent)) }
    : { ...budget, plan: "standard", message: null };
}
