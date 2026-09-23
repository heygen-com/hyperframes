import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPlayerAssetsReady } from "./runner.ts";

type Pred = () => boolean;

/** A page whose `__playerAssetsReady` flips after `gateMs`, polled like puppeteer's waitForFunction. */
function pageWithSlowGate(gateMs: number) {
  const win: { __playerAssetsReady?: boolean } = {};
  setTimeout(() => (win.__playerAssetsReady = true), gateMs);
  return {
    waitForFunction: (pred: Pred, opts: { timeout: number }) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const poll = setInterval(() => {
          (globalThis as { window?: unknown }).window = win;
          if (pred()) {
            clearInterval(poll);
            resolve();
          } else if (Date.now() - started >= opts.timeout) {
            clearInterval(poll);
            reject(new Error(`Waiting failed: ${opts.timeout}ms exceeded`));
          }
        }, 5);
      }),
  };
}

describe("waitForPlayerAssetsReady", () => {
  afterEach(() => vi.useRealTimers());

  it("outlasts an asset gate slower than the old fixed 5s play-confirm window", async () => {
    vi.useFakeTimers();
    const page = pageWithSlowGate(7_000);
    const done = waitForPlayerAssetsReady(page as never);
    await vi.advanceTimersByTimeAsync(7_100);
    await expect(done).resolves.toBeUndefined();
  });

  it("names the queued asset gate when it never opens", async () => {
    vi.useFakeTimers();
    const page = pageWithSlowGate(60_000);
    const done = waitForPlayerAssetsReady(page as never, 1_000);
    const assertion = expect(done).rejects.toThrow(/never emitted assetsready.*queued behind/);
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
  });
});
