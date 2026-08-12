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
      return 0;
    });
    const sleep = vi.fn(async () => undefined);

    const result = await lazyScrollForCapture({ evaluate }, 15_000, { stepDelayMs: 10, sleep });

    expect(result.steps).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.degraded).toBe(false);
  });

  it("returns within the stage budget when evaluate never resolves", async () => {
    const evaluate = vi.fn(() => new Promise(() => undefined));
    const started = Date.now();
    const warnings: string[] = [];

    const result = await lazyScrollForCapture({ evaluate }, 25, {
      onWarning: (message) => warnings.push(message),
      sleep: async () => undefined,
    });

    expect(result.degraded).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(250);
    expect(warnings[0]).toMatch(/lazy-scroll evaluate timed out/i);
  });

  it("does not issue a recovery evaluate after the budget is exhausted", async () => {
    let now = 1_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const evaluate = vi.fn(() => {
      now += 100;
      return new Promise(() => undefined);
    });

    try {
      const result = await lazyScrollForCapture({ evaluate }, 30, { sleep: async () => undefined });
      expect(result.degraded).toBe(true);
      expect(evaluate).toHaveBeenCalledTimes(1);
    } finally {
      dateSpy.mockRestore();
    }
  });
});
