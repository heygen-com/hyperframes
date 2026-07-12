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
    const outcome = await pollSubCompositionTimelines(page, 1_000, 10);
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
      10,
      () => ["http://localhost/animations.js"],
      50, // grace
    );
    expect(outcome).toBe("script_failure");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("waits the full timeout when timelines are missing but no script failed", async () => {
    const page = makeMockPage(() => false);
    const outcome = await pollSubCompositionTimelines(page, 120, 10, () => []);
    expect(outcome).toBe("timeout");
  });

  it("keeps waiting through the grace window when failures appear but timelines register late", async () => {
    let calls = 0;
    const page = makeMockPage((expr) => {
      if (expr.includes("__hfForceTimelineRebind")) return undefined;
      calls++;
      return calls >= 3; // registers on the 3rd poll tick, inside the grace window
    });
    const outcome = await pollSubCompositionTimelines(
      page,
      60_000,
      10,
      () => ["http://localhost/late.js"],
      10_000, // generous grace — registration lands first
    );
    expect(outcome).toBe("ready");
  });
});
