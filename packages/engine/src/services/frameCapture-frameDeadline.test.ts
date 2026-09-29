/**
 * Tests for the per-frame drawElement deadline (`withFrameDeadline`, PRINFRA-488).
 *
 * The deadline races the capture round-trip from OUTSIDE `captureFrameCore`,
 * because puppeteer cannot abort an in-flight `page.evaluate`. That is exactly
 * why the stall counter has to live in the `onTimeout` hook: a wedged renderer
 * never returns, so no catch block inside the work promise ever runs. The first
 * shipped version incremented `session.deFrameTimeouts` in that unreachable
 * catch, so the counter — and the `CapturePerfSummary` field it feeds — read 0
 * on every stalled render.
 */

import { describe, expect, it, vi } from "vitest";
import { withFrameDeadline } from "./frameCapture.js";

describe("withFrameDeadline", () => {
  it("rejects with DeFrameTimeoutError and fires onTimeout when work outlives the deadline", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      // Never settles — the wedged-renderer shape.
      const raced = withFrameDeadline(new Promise<string>(() => {}), "frame 7", 15_000, onTimeout);
      const assertion = expect(raced).rejects.toThrow(/frame 7 exceeded 15000ms/);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the value through and leaves onTimeout alone when work wins", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const raced = withFrameDeadline(Promise.resolve("buffer"), "frame 7", 15_000, onTimeout);
      await expect(raced).resolves.toBe("buffer");
      // Past the deadline: the cleared timer must not fire late.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
