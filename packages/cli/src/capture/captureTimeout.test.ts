import { describe, expect, it } from "vitest";
import { TimeoutError } from "puppeteer-core";
import {
  PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS,
  StageBudgetTimeoutError,
  captureProtocolTimeoutMs,
  formatCaptureFailureReason,
  isNavigationTimeoutError,
  isProtocolEvaluateTimeoutError,
  withRemainingBudget,
} from "./captureTimeout.js";

describe("captureProtocolTimeoutMs", () => {
  it("uses the larger of nav timeout and post-nav budget", () => {
    expect(captureProtocolTimeoutMs(120_000, 90_000)).toBe(120_000);
    expect(captureProtocolTimeoutMs(30_000, 120_000)).toBe(120_000);
  });

  it("floors at 60s", () => {
    expect(captureProtocolTimeoutMs(5_000, 5_000)).toBe(60_000);
  });

  it("uses puppeteer default when inputs are non-finite", () => {
    expect(captureProtocolTimeoutMs(Number.POSITIVE_INFINITY, 120_000)).toBe(
      PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS,
    );
  });
});

describe("isNavigationTimeoutError", () => {
  it("matches Puppeteer TimeoutError navigation timeouts", () => {
    expect(
      isNavigationTimeoutError(new TimeoutError("Navigation timeout of 30000 ms exceeded")),
    ).toBe(true);
  });

  it("does not treat plain Error as navigation timeout", () => {
    expect(isNavigationTimeoutError(new Error("Navigation timeout of 30000 ms exceeded"))).toBe(
      false,
    );
  });

  it("still classifies message strings for BLOCKED.md formatting", () => {
    expect(isNavigationTimeoutError("Navigation timeout of 30000 ms exceeded")).toBe(true);
  });
});

describe("isProtocolEvaluateTimeoutError", () => {
  it("matches Puppeteer TimeoutError evaluate timeouts by instanceof", () => {
    expect(
      isProtocolEvaluateTimeoutError(
        new TimeoutError(
          "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        ),
      ),
    ).toBe(true);
  });

  it("treats non-navigation TimeoutError as evaluate/protocol timeout even if wording drifts", () => {
    expect(
      isProtocolEvaluateTimeoutError(new TimeoutError("Timed out after waiting 180000ms")),
    ).toBe(true);
  });

  it("ignores navigation TimeoutErrors", () => {
    expect(
      isProtocolEvaluateTimeoutError(new TimeoutError("Navigation timeout of 30000 ms exceeded")),
    ).toBe(false);
  });
});

describe("withRemainingBudget", () => {
  it("returns before a never-resolving promise when the budget elapses", async () => {
    const never = new Promise<string>(() => undefined);
    const started = Date.now();
    await expect(withRemainingBudget(never, 20, "never-resolve")).rejects.toBeInstanceOf(
      StageBudgetTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("resolves when work finishes inside the budget", async () => {
    await expect(withRemainingBudget(Promise.resolve("ok"), 100, "fast")).resolves.toBe("ok");
  });

  it("fails immediately when no budget remains", async () => {
    await expect(withRemainingBudget(Promise.resolve("ok"), 0, "empty")).rejects.toBeInstanceOf(
      StageBudgetTimeoutError,
    );
  });
});

describe("formatCaptureFailureReason", () => {
  it("describes evaluate/protocol timeouts as extraction failures", () => {
    const reason = formatCaptureFailureReason(
      "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
    );
    expect(reason).toMatch(/extraction timed out/i);
    expect(reason).not.toMatch(/navigation timed out/i);
  });

  it("keeps navigation timeout wording for nav failures", () => {
    expect(formatCaptureFailureReason("Navigation timeout of 30000 ms exceeded")).toMatch(
      /navigation timed out/i,
    );
  });
});
