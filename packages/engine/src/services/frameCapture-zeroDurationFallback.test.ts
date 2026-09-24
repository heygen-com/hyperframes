import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { pollHfReady, ZERO_DURATION_FALLBACK_SECONDS } from "./frameCapture.js";

/**
 * pollHfReady uses string-expression page.evaluate calls:
 *   1. the readiness probe   (`... window.__hf.duration > 0`)
 *   2. the diagnostic        (contains "pendingBuildReadyKeys")
 *   3. the zero-duration recovery (contains "applying fallback duration")
 * This mock branches on those markers so we can drive the post-timeout
 * recovery path without a real browser.
 */
function makePage(opts: { recovered: number; onRecover?: () => void }): Page {
  return {
    evaluate: async (expr: unknown) => {
      const src = String(expr);
      if (src.includes("applying fallback duration")) {
        opts.onRecover?.();
        return opts.recovered;
      }
      if (src.includes("pendingBuildReadyKeys")) {
        return {
          renderReady: true,
          hasHf: true,
          hasSeek: true,
          hasPlayer: true,
          duration: 0,
          hasTimeline: true,
          declaredDuration: -1,
          pendingBuildReadyKeys: [],
          rejectedBuildReadyKeys: [],
        };
      }
      // readiness probe — never ready (duration stays 0 until the timeout)
      return false;
    },
  } as unknown as Page;
}

describe("pollHfReady zero-duration fallback", () => {
  it("exposes a positive fallback duration constant", () => {
    expect(ZERO_DURATION_FALLBACK_SECONDS).toBeGreaterThan(0);
  });

  it("recovers instead of hard-failing when a usable duration is found", async () => {
    let recoverCalled = false;
    const page = makePage({ recovered: 3, onRecover: () => (recoverCalled = true) });
    // Short timeout + interval so the loop reaches the post-timeout branch fast.
    await expect(pollHfReady(page, 20, 1)).resolves.toBeUndefined();
    expect(recoverCalled).toBe(true);
  });

  it("still hard-fails with the zero-duration diagnostic when recovery yields 0", async () => {
    const page = makePage({ recovered: 0 });
    await expect(pollHfReady(page, 20, 1)).rejects.toThrow(/Composition has zero duration/);
  });
});
