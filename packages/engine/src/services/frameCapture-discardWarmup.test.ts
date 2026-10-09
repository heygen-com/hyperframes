/**
 * Tests for `discardWarmupCapture` — the exported helper for discarded captures.
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

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discardWarmupCapture,
  getCapturePerfSummary,
  type CaptureSession,
} from "./frameCapture.js";

function makeFakeSession(): CaptureSession {
  // Capture is injected; provide the state needed for restoration and perf summaries.
  return {
    browser: {} as unknown,
    page: {} as unknown,
    options: { width: 1, height: 1, fps: { num: 30, den: 1 } },
    serverUrl: "",
    outputDir: mkdtempSync(join(tmpdir(), "discard-warmup-")),
    onBeforeCapture: null,
    isInitialized: true,
    browserConsoleBuffer: [],
    warnings: [],
    capturePerf: {
      frames: 7,
      seekMs: 100,
      beforeCaptureMs: 50,
      screenshotMs: 200,
      totalMs: 350,
      frameMs: [11, 13, 17, 19, 23, 29, 31],
    },
    captureMode: "beginframe",
    beginFrameTimeTicks: 0,
    beginFrameIntervalMs: 33,
    beginFrameHasDamageCount: 4,
    beginFrameNoDamageCount: 3,
  } as unknown as CaptureSession;
}

describe("discardWarmupCapture", () => {
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
      rmSync(session.outputDir, { recursive: true, force: true });
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
      rmSync(session.outputDir, { recursive: true, force: true });
    }
  });

  it("restores perf counters after the inner capture mutates them", async () => {
    const session = makeFakeSession();
    const before = { ...session.capturePerf, frameMs: [...session.capturePerf.frameMs] };
    const summaryBefore = getCapturePerfSummary(session);
    try {
      await discardWarmupCapture(session, 0, 0, async (s) => {
        s.capturePerf.frames += 1;
        s.capturePerf.seekMs += 12;
        s.capturePerf.beforeCaptureMs += 5;
        s.capturePerf.screenshotMs += 33;
        s.capturePerf.totalMs += 50;
        s.capturePerf.frameMs.push(50);
        return { buffer: Buffer.alloc(0), quantizedTime: 0, captureTimeMs: 50 };
      });
      expect(session.capturePerf).toEqual(before);
      expect(getCapturePerfSummary(session)).toEqual(summaryBefore);
    } finally {
      rmSync(session.outputDir, { recursive: true, force: true });
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
      rmSync(session.outputDir, { recursive: true, force: true });
    }
  });

  it("restores state even when the inner capture throws", async () => {
    const session = makeFakeSession();
    const perfBefore = { ...session.capturePerf, frameMs: [...session.capturePerf.frameMs] };
    const summaryBefore = getCapturePerfSummary(session);
    const hasBefore = session.beginFrameHasDamageCount;
    const noBefore = session.beginFrameNoDamageCount;
    try {
      const failure = new Error("simulated capture failure");
      await expect(
        discardWarmupCapture(session, 0, 0, async (s) => {
          s.capturePerf.frames += 5;
          s.capturePerf.frameMs.push(50);
          s.beginFrameNoDamageCount += 2;
          throw failure;
        }),
      ).rejects.toBe(failure);
      // The whole point of `finally { restore }`: failure must not leak
      // inflated counters into the real capture summary.
      expect(session.capturePerf).toEqual(perfBefore);
      expect(getCapturePerfSummary(session)).toEqual(summaryBefore);
      expect(session.beginFrameHasDamageCount).toBe(hasBefore);
      expect(session.beginFrameNoDamageCount).toBe(noBefore);
    } finally {
      rmSync(session.outputDir, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    "restores samples after their contents are replaced (throws=%s)",
    async (throws) => {
      const session = makeFakeSession();
      const samplesBefore = [...session.capturePerf.frameMs];
      const summaryBefore = getCapturePerfSummary(session);
      const failure = new Error("discarded capture failed");
      try {
        const capture = discardWarmupCapture(session, 240, 8, async (s) => {
          s.capturePerf.frameMs.splice(0, s.capturePerf.frameMs.length, 9000);
          if (throws) throw failure;
          return { buffer: Buffer.alloc(0), quantizedTime: 8, captureTimeMs: 0 };
        });
        if (throws) await expect(capture).rejects.toBe(failure);
        else await capture;
        expect(session.capturePerf.frameMs).toEqual(samplesBefore);
        expect(getCapturePerfSummary(session)).toEqual(summaryBefore);
      } finally {
        rmSync(session.outputDir, { recursive: true, force: true });
      }
    },
  );

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
      rmSync(session.outputDir, { recursive: true, force: true });
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
      rmSync(session.outputDir, { recursive: true, force: true });
    }
  });
});
