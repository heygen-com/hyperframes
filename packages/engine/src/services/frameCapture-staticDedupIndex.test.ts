import { describe, it, expect } from "vitest";
import { captureFrameToBuffer, type CaptureSession } from "./frameCapture.js";

/**
 * Regression lock for the static-dedup reuse index.
 *
 * `captureFrameCore` must key the static-frame reuse set on the ABSOLUTE
 * composition frame — derived from `time` (`round(time * fps)`) — NOT the
 * `frameIndex` argument. Distributed / per-worker-range / parallel callers pass
 * a chunk-RELATIVE `frameIndex` (captureStage passes the loop `i`,
 * parallelCoordinator passes `i - outputFrameOffset`) while `staticFrames` is
 * keyed in absolute frames. A prior bug used `frameIndex`, so a chunk with
 * `startFrame > 0` reused the wrong frames (and the right frames missed).
 *
 * The reuse branch returns BEFORE any page interaction, so we can exercise the
 * decision with a stub session whose `page` throws if touched: a dedup HIT
 * returns the cached buffer (page untouched); a MISS proceeds to the page and
 * rejects. Both assertions below FAIL on the pre-fix (relative-index) code.
 */

const SENTINEL = Buffer.from("cached-anchor-frame");

// ponytail: minimal stub of the 40-field CaptureSession — only the fields the
// reuse decision reads are real; `page` is a trap that throws on any access so
// a dedup MISS (which falls through to prepareFrameForCapture) rejects loudly.
function makeSession(staticFrames: Set<number>, fps: { num: number; den: number }): CaptureSession {
  const pageTrap = new Proxy(
    {},
    {
      get() {
        throw new Error("PAGE_TOUCHED");
      },
    },
  );
  return {
    page: pageTrap,
    options: { fps, format: "jpg" },
    captureMode: "screenshot",
    isInitialized: false,
    staticFrames,
    lastFrameBuffer: SENTINEL,
    staticDedupCount: 0,
  } as unknown as CaptureSession;
}

describe("static-dedup reuse keys on absolute frame index (time), not relative frameIndex", () => {
  const fps30 = { num: 30, den: 1 };

  it("HIT: relative frameIndex=0 but absolute time=90/30 reuses the anchor", async () => {
    const session = makeSession(new Set([90]), fps30);
    // Pre-fix used frameIndex (0) ∉ {90} → would miss → page trap throws.
    const result = await captureFrameToBuffer(session, 0, 90 / 30);
    expect(result.buffer).toBe(SENTINEL);
    expect(session.staticDedupCount).toBe(1);
  });

  it("MISS: relative frameIndex=90 but absolute time=0 does NOT reuse", async () => {
    const session = makeSession(new Set([90]), fps30);
    // Pre-fix used frameIndex (90) ∈ {90} → would wrongly reuse the anchor.
    await expect(captureFrameToBuffer(session, 90, 0)).rejects.toThrow();
    expect(session.staticDedupCount).toBe(0);
  });

  it("non-integer fps (29.97) recovers the absolute index exactly", async () => {
    const fps2997 = { num: 30000, den: 1001 };
    const session = makeSession(new Set([100]), fps2997);
    const time = (100 * fps2997.den) / fps2997.num; // absolute frame 100 → time
    const result = await captureFrameToBuffer(session, 7, time);
    expect(result.buffer).toBe(SENTINEL);
  });

  it("no reuse when the absolute frame is not in the static set", async () => {
    const session = makeSession(new Set([10, 11, 12]), fps30);
    await expect(captureFrameToBuffer(session, 0, 50 / 30)).rejects.toThrow();
  });
});
