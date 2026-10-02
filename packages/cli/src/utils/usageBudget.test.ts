import { describe, expect, it } from "vitest";
import { parseHarnessUsage } from "./usageBudget.js";

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
