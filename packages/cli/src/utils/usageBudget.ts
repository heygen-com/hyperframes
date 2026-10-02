import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";

const LOW_USAGE_REMAINING_PERCENT = 20;
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
      harness: "claude-code" | "codex" | "grok";
      session: UsageWindow | null;
      weekly: UsageWindow | null;
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
  return planUsage("claude-code", session, weekly);
}

function planUsage(
  harness: "claude-code" | "codex" | "grok",
  session: UsageWindow | null,
  weekly: UsageWindow | null,
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
  const remainingPercent = Math.min(...windows.map((window) => window.remainingPercent));
  const budget = { status: "known", harness, session, weekly, remainingPercent } as const;
  return remainingPercent <= LOW_USAGE_REMAINING_PERCENT
    ? { ...budget, plan: "first-cut-first", message: firstCutMessage(Math.floor(remainingPercent)) }
    : { ...budget, plan: "standard", message: null };
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
  return planUsage("codex", windows.session, windows.weekly);
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
  return planUsage("grok", null, {
    remainingPercent: 100 - (usage.config.creditUsagePercent ?? 0),
    resetsAt: new Date(end).toISOString(),
  });
}
