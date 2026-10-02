import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";

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

type UsageWindow = { usedPercent: number; remainingPercent: number; resetsAt: string | null };
export type HarnessUsage =
  | { status: "unknown"; reason: string }
  | {
      status: "known";
      harness: "claude-code" | "codex" | "grok";
      session: UsageWindow | null;
      weekly: UsageWindow | null;
      planTier: string | null;
    };

export const unknownUsage = (reason: string): HarnessUsage => ({ status: "unknown", reason });

export function parseHarnessUsage(text: string): HarnessUsage {
  const usage = parseUsage(text);
  if (!usage) return unknownUsage("invalid_usage_response");
  const normalize = (
    window: NonNullable<JTDDataType<typeof windowSchema>> | null,
  ): UsageWindow | null => {
    if (window === null) return null;
    return {
      usedPercent: window.utilization,
      remainingPercent: 100 - window.utilization,
      resetsAt: window.resets_at ?? null,
    };
  };
  const session = normalize(usage.five_hour);
  const weekly = normalize(usage.seven_day);
  return knownUsage("claude-code", session, weekly);
}

function knownUsage(
  harness: "claude-code" | "codex" | "grok",
  session: UsageWindow | null,
  weekly: UsageWindow | null,
  planTier: string | null = null,
): HarnessUsage {
  const windows = [session, weekly].filter((window): window is UsageWindow => window !== null);
  if (
    !windows.length ||
    windows.some(
      (window) =>
        !Number.isFinite(window.remainingPercent) ||
        window.remainingPercent < 0 ||
        window.remainingPercent > 100,
    )
  )
    return unknownUsage("invalid_usage_response");
  return { status: "known", harness, session, weekly, planTier };
}

const codexWindowSchema = {
  nullable: true,
  properties: { used_percent: { type: "float64" } },
  optionalProperties: {
    limit_window_seconds: { type: "float64" },
    reset_at: { type: "float64" },
    reset_after_seconds: { type: "float64" },
  },
  additionalProperties: true,
} as const;
const codexSchema = {
  optionalProperties: { plan_type: { type: "string" } },
  properties: {
    rate_limit: {
      optionalProperties: {
        primary_window: codexWindowSchema,
        secondary_window: codexWindowSchema,
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;
const grokSchema = {
  properties: {
    config: {
      properties: {
        currentPeriod: {
          properties: {
            type: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      optionalProperties: { creditUsagePercent: { type: "float64" } },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;
const parser = new Ajv();
const parseCodex = parser.compileParser<JTDDataType<typeof codexSchema>>(codexSchema);
const parseGrok = parser.compileParser<JTDDataType<typeof grokSchema>>(grokSchema);

type CodexWindow = NonNullable<JTDDataType<typeof codexWindowSchema>>;

function codexWindowKind(
  seconds: number | undefined,
  index: number,
): "session" | "weekly" | "unknown" {
  switch (seconds) {
    case 18000:
      return "session";
    case 604800:
      return "weekly";
    case undefined:
      return index === 0 ? "session" : "weekly";
    default:
      return "unknown";
  }
}

function normalizeCodexWindow(raw: CodexWindow, now: number): UsageWindow | null {
  const reset =
    raw.reset_at ??
    (raw.reset_after_seconds === undefined ? undefined : now / 1000 + raw.reset_after_seconds);
  if (reset !== undefined && (!Number.isFinite(reset) || Math.abs(reset * 1000) > 8640000000000000))
    return null;
  return {
    usedPercent: raw.used_percent,
    remainingPercent: 100 - raw.used_percent,
    resetsAt: reset === undefined ? null : new Date(reset * 1000).toISOString(),
  };
}

export function parseCodexUsage(text: string, now = Date.now()): HarnessUsage {
  const usage = parseCodex(text);
  if (!usage) return unknownUsage("invalid_usage_response");
  const windows: { session: UsageWindow | null; weekly: UsageWindow | null } = {
    session: null,
    weekly: null,
  };
  for (const [index, raw] of [
    usage.rate_limit.primary_window,
    usage.rate_limit.secondary_window,
  ].entries()) {
    if (!raw) continue;
    const kind = codexWindowKind(raw.limit_window_seconds, index);
    if (kind === "unknown") return unknownUsage("unsupported_usage_window");
    const window = normalizeCodexWindow(raw, now);
    if (window === null || windows[kind] !== null) return unknownUsage("invalid_usage_response");
    windows[kind] = window;
  }
  return knownUsage("codex", windows.session, windows.weekly, usage.plan_type ?? null);
}

export function parseGrokUsage(text: string): HarnessUsage {
  const usage = parseGrok(text);
  if (!usage) return unknownUsage("invalid_usage_response");
  const period = usage.config.currentPeriod;
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return unknownUsage("invalid_usage_response");
  if (period.type !== "USAGE_PERIOD_TYPE_WEEKLY") return unknownUsage("unsupported_usage_window");
  return knownUsage("grok", null, {
    usedPercent: usage.config.creditUsagePercent ?? 0,
    remainingPercent: 100 - (usage.config.creditUsagePercent ?? 0),
    resetsAt: new Date(end).toISOString(),
  });
}
