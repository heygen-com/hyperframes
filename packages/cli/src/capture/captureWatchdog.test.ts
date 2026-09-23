import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureWatchdog, parseCaptureDeadline, runWithWatchdog } from "./captureWatchdog.js";

describe("parseCaptureDeadline", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["0", undefined],
    ["1.5", undefined],
    ["240000", 240000],
  ])("parses %s as %s", (raw, expected) => expect(parseCaptureDeadline(raw)).toBe(expected));
});

describe("createCaptureWatchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("closes the registered browser and resolves the deadline signal", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockResolvedValue(undefined);
    const watchdog = createCaptureWatchdog(1000);
    watchdog.registerBrowser({ close });

    await vi.advanceTimersByTimeAsync(1000);
    await expect(watchdog.promise).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(watchdog.expired()).toBe(true);
    watchdog.dispose();
  });

  it("observes a losing attempt rejection instead of leaving it unhandled", async () => {
    vi.useFakeTimers();
    const watchdog = createCaptureWatchdog(1);
    const work = new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error("browser closed")), 10);
    });
    const resultPromise = runWithWatchdog(work, watchdog.promise);
    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({ kind: "deadline" });
    await vi.advanceTimersByTimeAsync(9);
    watchdog.dispose();
  });
});
