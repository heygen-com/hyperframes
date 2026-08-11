import { describe, expect, it, vi } from "vitest";
import { lazyScrollForCapture } from "./lazyScrollForCapture.js";

describe("lazyScrollForCapture", () => {
  it("no-ops when budget is empty", async () => {
    const evaluate = vi.fn();
    const result = await lazyScrollForCapture({ evaluate }, 0);
    expect(result).toEqual({ steps: 0, timedOut: false, degraded: false });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("scrolls in node-driven steps until the bottom", async () => {
    const heights = [{ atBottom: false }, { atBottom: false }, { atBottom: true }];
    const evaluate = vi.fn(async (expr: string) => {
      if (expr.includes("atBottom")) {
        return heights.shift() ?? { atBottom: true };
      }
      return undefined;
    });
    const sleep = vi.fn(async () => undefined);

    const result = await lazyScrollForCapture({ evaluate }, 15_000, { stepDelayMs: 10, sleep });

    expect(result.steps).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.degraded).toBe(false);
    expect(evaluate).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalled();
  });

  it("stops when the budget elapses", async () => {
    let now = 1_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const evaluate = vi.fn(async (expr: string) => {
      if (expr.includes("atBottom")) {
        now += 600;
        return { atBottom: false };
      }
      return undefined;
    });
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    try {
      const result = await lazyScrollForCapture({ evaluate }, 1_000, { stepDelayMs: 400, sleep });
      expect(result.steps).toBeGreaterThan(0);
      expect(result.timedOut).toBe(true);
      expect(result.degraded).toBe(false);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("degrades on protocol evaluate timeout instead of throwing", async () => {
    const warnings: string[] = [];
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        ),
      )
      .mockResolvedValue(undefined);

    const result = await lazyScrollForCapture({ evaluate }, 15_000, {
      onWarning: (message) => warnings.push(message),
      sleep: async () => undefined,
    });

    expect(result.degraded).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(warnings[0]).toMatch(/lazy-scroll evaluate timed out/i);
  });
});
