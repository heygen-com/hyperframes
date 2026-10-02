import { describe, expect, it } from "vitest";
import { parseHarnessUsage, parseCodexUsage, parseGrokUsage } from "./usageBudget.js";

const windows = (session: number, weekly: number) =>
  JSON.stringify({
    five_hour: { utilization: session, resets_at: null },
    seven_day: { utilization: weekly, resets_at: "2026-10-09T00:00:00Z" },
  });

describe("harness usage run plan", () => {
  it("keeps the standard flow when both windows have more than 20% left", () => {
    expect(parseHarnessUsage(windows(79, 20))).toMatchObject({
      status: "known",
      remainingPercent: 21,
      plan: "standard",
      message: null,
    });
  });
  it.each([
    [80, 10],
    [10, 80],
    [100, 10],
  ])("renders first when a shared window is low (%s, %s)", (session, weekly) => {
    expect(parseHarnessUsage(windows(session, weekly))).toMatchObject({
      status: "known",
      plan: "first-cut-first",
    });
  });
  it("reports the limiting window and the single user-facing plan sentence", () => {
    expect(parseHarnessUsage(windows(81, 95))).toEqual({
      status: "known",
      harness: "claude-code",
      session: { remainingPercent: 19, resetsAt: null },
      weekly: { remainingPercent: 5, resetsAt: "2026-10-09T00:00:00Z" },
      remainingPercent: 5,
      plan: "first-cut-first",
      message: "You have about 5% usage left; I'll make a first watchable cut before polishing.",
    });
  });
  it.each([
    "not-json",
    "{}",
    '{"five_hour":null,"seven_day":null}',
    windows(-1, 20),
    windows(10, 101),
    '{"five_hour":{"utilization":"80"},"seven_day":{"utilization":10}}',
  ])("uses the standard flow when the budget is unknown: %s", (text) => {
    expect(parseHarnessUsage(text)).toEqual({
      status: "unknown",
      reason: "invalid_usage_response",
      plan: "standard",
      message: null,
    });
  });
});

it("maps a sole Codex weekly primary window by its duration", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 85, limit_window_seconds: 604800, reset_at: 1791504000 },
        },
      }),
    ),
  ).toMatchObject({
    status: "known",
    harness: "codex",
    session: null,
    weekly: { remainingPercent: 15 },
    remainingPercent: 15,
    plan: "first-cut-first",
  });
});
it("maps Grok weekly credits and preserves its missing session window", () => {
  expect(
    parseGrokUsage(
      JSON.stringify({
        config: {
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-10-01T00:00:00Z",
            end: "2026-10-08T00:00:00Z",
          },
          creditUsagePercent: 90,
        },
      }),
    ),
  ).toMatchObject({
    status: "known",
    harness: "grok",
    session: null,
    weekly: { remainingPercent: 10 },
    plan: "first-cut-first",
  });
});
it("honors Grok proto JSON's omitted zero usage", () => {
  expect(
    parseGrokUsage(
      JSON.stringify({
        config: {
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-10-01T00:00:00Z",
            end: "2026-10-08T00:00:00Z",
          },
        },
      }),
    ),
  ).toMatchObject({ status: "known", remainingPercent: 100, plan: "standard" });
});
it.each([
  ["codex", "{}"],
  ["codex", '{"rate_limit":{"primary_window":{"used_percent":101}}}'],
  [
    "grok",
    '{"config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"bad","end":"bad"}}}',
  ],
])("returns unknown for invalid %s allowance", (harness, text) => {
  expect((harness === "codex" ? parseCodexUsage(text) : parseGrokUsage(text)).status).toBe(
    "unknown",
  );
});

it("rejects duplicate Codex window durations instead of losing the tighter limit", () => {
  expect(
    parseCodexUsage(
      JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 90, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 10, limit_window_seconds: 18000 },
        },
      }),
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid_usage_response" });
});
