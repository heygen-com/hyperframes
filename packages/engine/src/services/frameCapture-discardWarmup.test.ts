/**
 * Tests for `discardWarmupCapture` — the helper screenshot-mode parallel
 * workers run before their first real capture to settle their first seek.
 *
 * The helper is a thin wrapper around the inner `captureFrameCore`
 * machinery, so its testable contract is post-conditional rather than
 * pixel-level:
 *
 *   1. The wrapper invokes the inner capture exactly once with the supplied
 *      `(frameIndex, time)`.
 *   2. After the wrapper returns, the session's perf and BeginFrame damage
 *      counters look exactly as they did before — even though the inner
 *      capture mutated them.
 *   3. The wrapper writes no file to disk (no path is plumbed through;
 *      asserted indirectly by observing that `outputDir` is never read).
 *   4. State is restored even if the inner capture throws.
 *
 * The inner capture is stubbed (the helper accepts an injectable
 * `innerCapture` for exactly this reason). We don't need a real Chrome.
 */

import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureFrameToBuffer, discardWarmupCapture, type CaptureSession } from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js");

function makeFakeSession(): CaptureSession {
  // The discardWarmupCapture wrapper only reads `capturePerf`,
  // `beginFrameHasDamageCount`, `beginFrameNoDamageCount`. Everything else
  // is unused — leave it as bare-minimum stubs cast through `unknown`.
  return {
    browser: {} as unknown,
    page: {} as unknown,
    options: { width: 1, height: 1, fps: { num: 30, den: 1 } },
    serverUrl: "",
    outputDir: mkdtempSync(join(tmpdir(), "discard-warmup-")),
    onBeforeCapture: null,
    isInitialized: true,
    browserConsoleBuffer: [],
    capturePerf: {
      frames: 7,
      seekMs: 100,
      beforeCaptureMs: 50,
      screenshotMs: 200,
      totalMs: 350,
      frameMs: [40, 50],
    },
    captureMode: "screenshot",
    beginFrameTimeTicks: 0,
    beginFrameIntervalMs: 33,
    beginFrameHasDamageCount: 4,
    beginFrameNoDamageCount: 3,
  } as unknown as CaptureSession;
}

function cleanupSession(session: CaptureSession): void {
  rmSync(session.outputDir, { recursive: true, force: true });
}

describe("discardWarmupCapture", () => {
  it("settles and retains screenshots after a single seek", async () => {
    const session = makeFakeSession();
    const evaluate = vi.fn(async () => false);
    session.page = { evaluate } as unknown as CaptureSession["page"];
    vi.mocked(pageScreenshotCapture)
      .mockResolvedValueOnce(Buffer.from("warmup"))
      .mockResolvedValueOnce(Buffer.from("retained"));
    const result = await captureFrameToBuffer(session, 36, 1.2, true);
    expect(evaluate.mock.calls.filter((call) => call.length === 2)).toHaveLength(1);
    expect(pageScreenshotCapture).toHaveBeenCalledTimes(2);
    expect(result.buffer.toString()).toBe("retained");
    cleanupSession(session);
  });

  it("rejects BeginFrame sessions before issuing a duplicate compositor tick", async () => {
    const session = makeFakeSession();
    session.captureMode = "beginframe";
    let called = false;
    try {
      await expect(
        discardWarmupCapture(session, 36, 1.2, async () => {
          called = true;
          return { buffer: Buffer.alloc(0), quantizedTime: 1.2, captureTimeMs: 0 };
        }),
      ).rejects.toThrow("screenshot capture mode");
      expect(called).toBe(false);
    } finally {
      cleanupSession(session);
    }
  });

  it("calls the inner capture exactly once with (frameIndex=0, time=0) by default", async () => {
    const session = makeFakeSession();
    try {
      let calls = 0;
      let receivedFrameIndex = -1;
      let receivedTime = -1;
      await discardWarmupCapture(session, undefined, undefined, async (_s, fi, t) => {
        calls++;
        receivedFrameIndex = fi;
        receivedTime = t;
        return { buffer: Buffer.alloc(0), quantizedTime: t, captureTimeMs: 0 };
      });
      expect(calls).toBe(1);
      expect(receivedFrameIndex).toBe(0);
      expect(receivedTime).toBe(0);
    } finally {
      cleanupSession(session);
    }
  });

  it("passes through caller-supplied (frameIndex, time)", async () => {
    const session = makeFakeSession();
    try {
      let received: { fi: number; t: number } | null = null;
      await discardWarmupCapture(session, 240, 8, async (_s, fi, t) => {
        received = { fi, t };
        return { buffer: Buffer.alloc(0), quantizedTime: t, captureTimeMs: 0 };
      });
      expect(received).toEqual({ fi: 240, t: 8 });
    } finally {
      cleanupSession(session);
    }
  });

  it("restores perf counters after the inner capture mutates them", async () => {
    const session = makeFakeSession();
    const before = { ...session.capturePerf, frameMs: [...session.capturePerf.frameMs] };
    try {
      await discardWarmupCapture(session, 0, 0, async (s) => {
        s.capturePerf.frames += 1;
        s.capturePerf.seekMs += 12;
        s.capturePerf.beforeCaptureMs += 5;
        s.capturePerf.screenshotMs += 33;
        s.capturePerf.totalMs += 50;
        s.capturePerf.frameMs.push(999);
        return { buffer: Buffer.alloc(0), quantizedTime: 0, captureTimeMs: 50 };
      });
      expect(session.capturePerf).toEqual(before);
    } finally {
      cleanupSession(session);
    }
  });

  it("restores BeginFrame damage counters after the inner capture mutates them", async () => {
    const session = makeFakeSession();
    const hasBefore = session.beginFrameHasDamageCount;
    const noBefore = session.beginFrameNoDamageCount;
    try {
      await discardWarmupCapture(session, 0, 0, async (s) => {
        s.beginFrameHasDamageCount += 10;
        s.beginFrameNoDamageCount += 1;
        return { buffer: Buffer.alloc(0), quantizedTime: 0, captureTimeMs: 0 };
      });
      expect(session.beginFrameHasDamageCount).toBe(hasBefore);
      expect(session.beginFrameNoDamageCount).toBe(noBefore);
    } finally {
      cleanupSession(session);
    }
  });

  it("restores state even when the inner capture throws", async () => {
    const session = makeFakeSession();
    const perfBefore = { ...session.capturePerf };
    const hasBefore = session.beginFrameHasDamageCount;
    const noBefore = session.beginFrameNoDamageCount;
    try {
      let thrown: unknown;
      try {
        await discardWarmupCapture(session, 0, 0, async (s) => {
          s.capturePerf.frames += 5;
          s.beginFrameNoDamageCount += 2;
          throw new Error("simulated capture failure");
        });
      } catch (err) {
        thrown = err;
      }
      expect((thrown as Error).message).toBe("simulated capture failure");
      // The whole point of `finally { restore }`: failure must not leak
      // inflated counters into the real capture summary.
      expect(session.capturePerf).toEqual(perfBefore);
      expect(session.beginFrameHasDamageCount).toBe(hasBefore);
      expect(session.beginFrameNoDamageCount).toBe(noBefore);
    } finally {
      cleanupSession(session);
    }
  });

  it("writes no output file to the session's outputDir", async () => {
    const session = makeFakeSession();
    try {
      expect(existsSync(session.outputDir)).toBe(true);
      const before = readdirSync(session.outputDir);
      await discardWarmupCapture(session, 0, 0, async () => ({
        buffer: Buffer.from([0xff, 0xff, 0xff]),
        quantizedTime: 0,
        captureTimeMs: 0,
      }));
      const after = readdirSync(session.outputDir);
      expect(after).toEqual(before);
    } finally {
      cleanupSession(session);
    }
  });

  it("returns undefined (no result type, so the buffer can't escape)", async () => {
    const session = makeFakeSession();
    try {
      const result = await discardWarmupCapture(session, 0, 0, async () => ({
        buffer: Buffer.from([0x01]),
        quantizedTime: 0,
        captureTimeMs: 1,
      }));
      expect(result).toBeUndefined();
    } finally {
      cleanupSession(session);
    }
  });
});
