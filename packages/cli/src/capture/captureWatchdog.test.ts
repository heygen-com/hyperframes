import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureDeadlineTimeoutError,
  createCaptureWatchdog,
  parseCaptureDeadline,
} from "./captureWatchdog.js";

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

  it("closes the registered browser and rejects with a non-retryable timeout", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockResolvedValue(undefined);
    const watchdog = createCaptureWatchdog(1000);
    watchdog.registerBrowser({ close });

    const rejected = expect(watchdog.promise).rejects.toMatchObject({
      name: "CaptureDeadlineTimeoutError",
      retryable: false,
    } satisfies Partial<CaptureDeadlineTimeoutError>);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    expect(watchdog.expired()).toBe(true);
    watchdog.dispose();
  });
});
