import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  staticFramesInCaptureRange,
  verifyStaticFramesSafe,
  type CaptureSession,
} from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./screenshotService.js")>();
  return { ...actual, pageScreenshotCapture: vi.fn() };
});

// A parallel worker reuses frames only inside its own range, so it verifies only those
// (heygen-com/hyperframes#7370).
describe("static-dedup verification for a session that captures part of the timeline", () => {
  const fps = 30;
  // 1200 frames; a 5-frame tween at the start of every second, static in between.
  const staticFrames = new Set<number>();
  for (let frame = 1; frame < 1200; frame++) {
    if (frame % 30 >= 5) staticFrames.add(frame);
  }

  beforeEach(() => {
    vi.mocked(pageScreenshotCapture).mockReset();
    vi.mocked(pageScreenshotCapture).mockResolvedValue(Buffer.from("static"));
  });

  async function verify(frames: Set<number>) {
    const seeks: number[] = [];
    const page = {
      evaluate: vi.fn(async (_fn: unknown, t: number) => {
        seeks.push(Math.round(t * fps));
      }),
    };
    const result = await verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      frames,
      fps,
      24,
    );
    // The last seek puts the verification page back on frame 0.
    return { result, seeks: seeks.slice(0, -1) };
  }

  it("keeps the whole set when the session captures the whole timeline", () => {
    expect(staticFramesInCaptureRange(staticFrames, undefined)).toBe(staticFrames);
  });

  it("verifies only around the frames in the range", async () => {
    const range = { start: 400, end: 800 };
    const inRange = staticFramesInCaptureRange(staticFrames, range);
    expect([...inRange].every((frame) => frame >= 400 && frame < 800)).toBe(true);

    const { result, seeks } = await verify(inRange);

    expect(result.outcome).toBe("verified");
    expect(seeks.length).toBeGreaterThan(0);
    // The run that starts at the range's first frame is anchored one frame before it.
    expect(Math.min(...seeks)).toBeGreaterThanOrEqual(range.start - 1);
    expect(Math.max(...seeks)).toBeLessThan(range.end);
    expect([...result.verifiedFrames].every((frame) => inRange.has(frame))).toBe(true);
  });

  it("splits the verification work between workers instead of repeating it", async () => {
    const whole = await verify(staticFrames);
    const ranges = [
      { start: 0, end: 400 },
      { start: 400, end: 800 },
      { start: 800, end: 1200 },
    ];
    const perWorker = await Promise.all(
      ranges.map((range) => verify(staticFramesInCaptureRange(staticFrames, range))),
    );

    const workerScreenshots = perWorker.map(({ result }) => result.stats.screenshots);
    expect(workerScreenshots.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(
      whole.result.stats.screenshots + ranges.length,
    );
    // Between them the workers still verify every frame the whole-timeline pass did.
    const verifiedByWorkers = new Set(
      perWorker.flatMap(({ result }) => [...result.verifiedFrames]),
    );
    expect(verifiedByWorkers).toEqual(whole.result.verifiedFrames);
  });
});
