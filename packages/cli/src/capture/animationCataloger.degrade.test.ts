import { describe, expect, it, vi } from "vitest";
import { collectAnimationCatalog } from "./animationCataloger.js";

describe("collectAnimationCatalog degradation", () => {
  it("surfaces evaluate timeouts via timedOut instead of silent empty success", async () => {
    const page = {
      evaluate: vi.fn(() => new Promise(() => undefined)),
    };
    const cdp = {
      send: vi.fn(async () => undefined),
    };

    const outcome = await collectAnimationCatalog(page as never, [], cdp as never, {
      scrollBudgetMs: 20,
      evaluateBudgetMs: 20,
    });

    expect(outcome.timedOut).toBe(true);
    expect(outcome.catalog.summary.webAnimations).toBe(0);
    expect(cdp.send).toHaveBeenCalledWith("Animation.disable");
  });
});
