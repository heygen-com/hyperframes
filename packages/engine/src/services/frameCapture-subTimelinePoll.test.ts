/**
 * pollSubCompositionTimelines fail-fast contract: a script resource that
 * failed to load can never register its `window.__timelines[id]`, so the
 * poll must cut to the short grace window instead of burning the full
 * playerReadyTimeout (measured wild: a 705-render spike at the 45s setup
 * bucket over 30 days — ~1% of local renders).
 */

import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { pollSubCompositionTimelines } from "./frameCapture.js";

function makeMockPage(evaluateResults: (expr: string) => unknown): Page {
  return {
    evaluate: vi.fn(async (expr: string) => evaluateResults(expr)),
  } as unknown as Page;
}

describe("pollSubCompositionTimelines fail-fast", () => {
  it("returns ready and forces a timeline rebind when timelines register", async () => {
    const page = makeMockPage(() => true);
    const outcome = await pollSubCompositionTimelines(page, 1_000, { intervalMs: 10 });
    expect(outcome).toBe("ready");
    // Second evaluate is the __hfForceTimelineRebind call.
    expect((page.evaluate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("bails after the grace window when a script resource failed to load", async () => {
    const page = makeMockPage((expr) =>
      expr.includes("__hfForceTimelineRebind") ? undefined : false,
    );
    const started = Date.now();
    const outcome = await pollSubCompositionTimelines(
      page,
      60_000, // full timeout must NOT be waited
      {
        intervalMs: 10,
        getScriptLoadFailures: () => ["http://localhost/animations.js"],
        scriptFailureGraceMs: 50,
      },
    );
    expect(outcome).toBe("script_failure");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops at once when the caller says so, without waiting out the timeout", async () => {
    const page = makeMockPage((expr) =>
      expr.includes("__hfForceTimelineRebind") ? undefined : false,
    );
    const shouldStop = vi.fn(() => true);
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      shouldStop,
    });
    expect(outcome).toBe("timeout");
    expect(shouldStop).toHaveBeenCalledTimes(1);
  });

  it("waits the full timeout when timelines are missing but no script failed", async () => {
    const page = makeMockPage(() => false);
    const outcome = await pollSubCompositionTimelines(page, 120, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
    });
    expect(outcome).toBe("timeout");
  });

  it("keeps waiting through the grace window when failures appear but timelines register late", async () => {
    let calls = 0;
    const page = makeMockPage((expr) => {
      if (expr.includes("__hfForceTimelineRebind")) return undefined;
      calls++;
      return calls >= 3; // registers on the 3rd poll tick, inside the grace window
    });
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => ["http://localhost/late.js"],
      scriptFailureGraceMs: 10_000, // generous grace — registration lands first
    });
    expect(outcome).toBe("ready");
  });
});
