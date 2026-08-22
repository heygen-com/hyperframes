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

import { readFileSync } from "node:fs";
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

// The three drawElement capture entry points are only reachable with a real
// Chrome page, so the wiring is pinned at the source level instead. The first
// shipped deadline bounded ONLY the streaming path, leaving the disk and
// worker-encode paths to hit the 60 s render-level watchdog on the same wedged
// renderer — a coverage gap invisible to any unit test of the deadline itself.
describe("drawElement capture entry points", () => {
  const source = readFileSync(new URL("./frameCapture.ts", import.meta.url), "utf8");

  const bodyOf = (name: string): string => {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    // Up to the next top-level declaration — enough to cover the function body.
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it.each(["captureFrameToBuffer", "captureFrame", "captureFrameToBufferPipelined"])(
    "%s bounds its drawElement round-trip",
    (entryPoint) => {
      expect(bodyOf(entryPoint)).toContain("withDeFrameDeadline(");
    },
  );

  // Diagnostics screenshot and evaluate against the page that just stopped
  // scheduling, so running them on a stall spends the whole budget the deadline
  // saved. The pipelined catch must bail before reaching them.
  it("skips per-frame diagnostics when the pipelined path times out", () => {
    const body = bodyOf("captureFrameToBufferPipelined");
    const bail = body.indexOf("if (isDeFrameTimeoutError(captureError)) throw captureError;");
    const diagnostics = body.indexOf("captureFrameErrorDiagnostics(");
    expect(bail).toBeGreaterThan(-1);
    expect(diagnostics).toBeGreaterThan(bail);
  });
});
