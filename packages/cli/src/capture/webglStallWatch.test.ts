import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSession } from "puppeteer-core";
import { watchWebglStall } from "./webglStallWatch.js";

/** A page that answers `Runtime.evaluate` while `silent` is false. */
function fakePage() {
  const state = { silent: false };
  const cdp = {
    send: vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate" && state.silent) return new Promise(() => {});
      return {};
    }),
  } as unknown as CDPSession;
  return { cdp, state };
}

describe("watchWebglStall", () => {
  afterEach(() => vi.useRealTimers());

  it("calls onStall once when a page stops answering", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const onStall = vi.fn();
    watchWebglStall(page.cdp, onStall);
    page.state.silent = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onStall).toHaveBeenCalledOnce();
  });

  it("leaves a page that keeps answering alone", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    watchWebglStall(fakePage().cdp, onStall);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("stops probing once stopped", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const onStall = vi.fn();
    const watch = watchWebglStall(page.cdp, onStall);
    watch.stop();
    page.state.silent = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});
