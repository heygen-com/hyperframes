import { describe, expect, it } from "vitest";
import { parseHarnessUsage, parseCodexUsage, parseGrokUsage } from "./usageBudget.js";

const windows = (session: number, weekly: number) =>
  JSON.stringify({
    five_hour: { utilization: session, resets_at: null },
    seven_day: { utilization: weekly, resets_at: "2026-10-09T00:00:00Z" },
  });

describe("Claude shared usage visibility", () => {
  it("preserves independent usage percentages and reset times", () => {
    expect(parseHarnessUsage(windows(81, 95))).toEqual({
      status: "known",
      spend: null,
      harness: "claude-code",
      planTier: null,
      session: { usedPercent: 81, remainingPercent: 19, resetsAt: null },
      weekly: { usedPercent: 95, remainingPercent: 5, resetsAt: "2026-10-09T00:00:00Z" },
    });
  });
  it("preserves an independently absent Claude session window", () => {
    expect(
      parseHarnessUsage('{"five_hour":null,"seven_day":{"utilization":95,"resets_at":null}}'),
    ).toEqual({
      status: "known",
      spend: null,
      harness: "claude-code",
      planTier: null,
      session: null,
      weekly: { usedPercent: 95, remainingPercent: 5, resetsAt: null },
    });
  });
  it("preserves empty and fully used windows", () => {
    expect(parseHarnessUsage(windows(0, 100))).toEqual({
      status: "known",
      spend: null,
      harness: "claude-code",
      planTier: null,
      session: { usedPercent: 0, remainingPercent: 100, resetsAt: null },
      weekly: { usedPercent: 100, remainingPercent: 0, resetsAt: "2026-10-09T00:00:00Z" },
    });
  });
  it.each([
    "not-json",
    "{}",
    windows(-1, 20),
    windows(10, 101),
    '{"five_hour":{"utilization":"80"},"seven_day":{"utilization":10}}',
  ])("rejects invalid shared usage: %s", (text) => {
    expect(parseHarnessUsage(text)).toEqual({
      status: "unknown",
      reason: "invalid_usage_response",
    });
  });
});

describe("Claude spend-metered plans", () => {
  it("reports no usage windows instead of an invalid response when every window is absent", () => {
    expect(parseHarnessUsage('{"five_hour":null,"seven_day":null}')).toEqual({
      status: "unknown",
      reason: "no_usage_windows",
    });
  });
  it("exposes the spend share when the five-hour and weekly windows are absent", () => {
    expect(
      parseHarnessUsage(
        JSON.stringify({
          five_hour: null,
          seven_day: null,
          spend: { percent: 42.5, enabled: true, severity: "normal" },
          extra_usage: { is_enabled: true, utilization: 10 },
        }),
      ),
    ).toEqual({
      status: "known",
      harness: "claude-code",
      planTier: null,
      session: null,
      weekly: null,
      spend: { usedPercent: 42.5, remainingPercent: 57.5, resetsAt: null },
    });
  });
  it("falls back to extra usage utilization when spend is absent", () => {
    expect(
      parseHarnessUsage(
        JSON.stringify({
          five_hour: null,
          seven_day: null,
          extra_usage: { is_enabled: true, utilization: 30 },
        }),
      ),
    ).toMatchObject({
      status: "known",
      spend: { usedPercent: 30, remainingPercent: 70, resetsAt: null },
    });
  });
  it("caps spend over the limit at fully used", () => {
    expect(
      parseHarnessUsage(
        JSON.stringify({
          five_hour: null,
          seven_day: null,
          spend: { percent: 120, enabled: true },
        }),
      ),
    ).toMatchObject({ status: "known", spend: { usedPercent: 100, remainingPercent: 0 } });
  });
  it("ignores disabled spend and keeps reporting rate windows", () => {
    expect(
      parseHarnessUsage(
        JSON.stringify({
          five_hour: { utilization: 5 },
          seven_day: null,
          spend: { percent: 80, enabled: false },
        }),
      ),
    ).toMatchObject({ status: "known", spend: null, session: { usedPercent: 5 } });
  });
  it("rejects a negative spend share", () => {
    expect(
      parseHarnessUsage(
        JSON.stringify({ five_hour: null, seven_day: null, spend: { percent: -1, enabled: true } }),
      ),
    ).toEqual({ status: "unknown", reason: "invalid_usage_response" });
  });
});

it("maps Codex windows by duration and exposes its reported plan tier", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 85, limit_window_seconds: 604800, reset_at: 3600 },
          secondary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 7200 },
        },
      }),
    ),
  ).toEqual({
    status: "known",
    spend: null,
    harness: "codex",
    planTier: "pro",
    session: { usedPercent: 25, remainingPercent: 75, resetsAt: "1970-01-01T02:00:00.000Z" },
    weekly: { usedPercent: 85, remainingPercent: 15, resetsAt: "1970-01-01T01:00:00.000Z" },
    monthly: null,
  });
});
it("maps a 30-day Codex allowance to a monthly window", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        plan_type: "free",
        rate_limit: {
          primary_window: { used_percent: 72, limit_window_seconds: 2592000, reset_at: 7200 },
          secondary_window: null,
        },
      }),
    ),
  ).toEqual({
    status: "known",
    spend: null,
    harness: "codex",
    planTier: "free",
    session: null,
    weekly: null,
    monthly: { usedPercent: 72, remainingPercent: 28, resetsAt: "1970-01-01T02:00:00.000Z" },
  });
});
it.each([undefined, null])(
  "preserves an absent Codex session window and unavailable plan tier: %s",
  (planTier) => {
    expect(
      parseCodexUsage(
        JSON.stringify({
          plan_type: planTier,
          rate_limit: {
            primary_window: { used_percent: 85, limit_window_seconds: 604800 },
          },
        }),
      ),
    ).toEqual({
      status: "known",
      spend: null,
      harness: "codex",
      planTier: null,
      session: null,
      weekly: { usedPercent: 85, remainingPercent: 15, resetsAt: null },
      monthly: null,
    });
  },
);
it("converts Codex relative resets using the supplied observation time", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 10, reset_after_seconds: 60 },
        },
      }),
      0,
    ),
  ).toEqual({
    status: "known",
    spend: null,
    harness: "codex",
    planTier: null,
    weekly: null,
    monthly: null,
    session: { usedPercent: 10, remainingPercent: 90, resetsAt: "1970-01-01T00:01:00.000Z" },
  });
});
it.each([
  "{}",
  '{"rate_limit":{"primary_window":{"used_percent":101}}}',
  '{"rate_limit":{"primary_window":{"used_percent":-1}}}',
  '{"rate_limit":{"primary_window":{"used_percent":10,"reset_at":9000000000000}}}',
])("rejects invalid Codex allowance: %s", (text) => {
  expect(parseCodexUsage(text)).toEqual({ status: "unknown", reason: "invalid_usage_response" });
});
it("reports no usage windows for an empty Codex rate limit", () => {
  expect(parseCodexUsage('{"rate_limit":{}}')).toEqual({
    status: "unknown",
    reason: "no_usage_windows",
  });
});
it("rejects unsupported Codex durations", () => {
  expect(
    parseCodexUsage(
      '{"rate_limit":{"primary_window":{"used_percent":10,"limit_window_seconds":60}}}',
    ),
  ).toEqual({ status: "unknown", reason: "unsupported_usage_window" });
});
it("rejects duplicate Codex durations instead of overwriting a window", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 90, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 10, limit_window_seconds: 18000 },
        },
      }),
    ),
  ).toEqual({ status: "unknown", reason: "invalid_usage_response" });
});
it("rejects duplicate monthly Codex durations instead of overwriting a window", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 90, limit_window_seconds: 2592000 },
          secondary_window: { used_percent: 10, limit_window_seconds: 2592000 },
        },
      }),
    ),
  ).toEqual({ status: "unknown", reason: "invalid_usage_response" });
});

const grokPeriod = {
  type: "USAGE_PERIOD_TYPE_WEEKLY",
  start: "2026-10-01T00:00:00Z",
  end: "2026-10-08T00:00:00Z",
};
it("exposes Grok weekly credits without inventing a session or plan tier", () => {
  expect(
    parseGrokUsage(
      JSON.stringify({ config: { currentPeriod: grokPeriod, creditUsagePercent: 90 } }),
    ),
  ).toEqual({
    status: "known",
    spend: null,
    harness: "grok",
    planTier: null,
    session: null,
    weekly: { usedPercent: 90, remainingPercent: 10, resetsAt: "2026-10-08T00:00:00.000Z" },
  });
});
it("honors Grok proto JSON's omitted zero usage", () => {
  expect(parseGrokUsage(JSON.stringify({ config: { currentPeriod: grokPeriod } }))).toEqual({
    status: "known",
    spend: null,
    harness: "grok",
    planTier: null,
    session: null,
    weekly: { usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-08T00:00:00.000Z" },
  });
});
it.each([
  "{}",
  '{"config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"bad","end":"bad"}}}',
  JSON.stringify({ config: { currentPeriod: grokPeriod, creditUsagePercent: 101 } }),
  JSON.stringify({ config: { currentPeriod: { ...grokPeriod, end: grokPeriod.start } } }),
])("rejects invalid Grok allowance: %s", (text) => {
  expect(parseGrokUsage(text)).toEqual({ status: "unknown", reason: "invalid_usage_response" });
});
it("rejects an unsupported Grok period", () => {
  expect(
    parseGrokUsage(
      JSON.stringify({
        config: { currentPeriod: { ...grokPeriod, type: "USAGE_PERIOD_TYPE_DAILY" } },
      }),
    ),
  ).toEqual({ status: "unknown", reason: "unsupported_usage_window" });
});
