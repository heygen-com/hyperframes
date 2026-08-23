import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  planStaticVerification,
  verifyStaticFramesSafe,
  type CaptureSession,
} from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./screenshotService.js")>();
  return { ...actual, pageScreenshotCapture: vi.fn() };
});

/**
 * Behavior-level lock: a real content change that reverts before the run's end
 * (so the always-checked endpoint alone would NOT reveal it) must still be
 * caught once it falls within the new, denser sample spacing — even though the
 * old flat 8-point-per-run density would have skipped straight past it.
 */
describe("verifyStaticFramesSafe catches drift the old fixed-point density would miss", () => {
  const fps = 30;

  beforeEach(() => {
    vi.mocked(pageScreenshotCapture).mockReset();
  });

  it("flags a transient content change hidden between the old sample gaps", async () => {
    const a = 1;
    const b = 2000;
    const sampleCount = 24;

    // Pick a frame the OLD formula would have skipped but the NEW one samples,
    // and confirm the endpoint alone (checked either way) would NOT reveal it —
    // isolating the assertion to interior-sample density, not the end-of-run check.
    const plannedRun = planStaticVerification(
      new Set(Array.from({ length: b - a + 1 }, (_, index) => a + index)),
      sampleCount,
    ).runs[0];
    const changeAt = plannedRun?.comparisons.find((frame) => frame !== b);
    if (changeAt === undefined) throw new Error("test setup: no interior planned comparison");

    // Content is "before" everywhere except a single transient frame that reverts
    // immediately after — the anchor (a-1) and the run's end (b) both read "before".
    const contentAt = (f: number) => (f === changeAt ? "glitch" : "before");

    let lastFrameIdx = 0;
    const page = {
      evaluate: vi.fn(async (_fn: unknown, t: number) => {
        lastFrameIdx = Math.round(t * fps);
      }),
    };
    vi.mocked(pageScreenshotCapture).mockImplementation(async () =>
      Buffer.from(contentAt(lastFrameIdx)),
    );

    const staticFrames = new Set<number>();
    for (let f = a; f <= b; f++) staticFrames.add(f);

    const session = { options: {} } as unknown as CaptureSession;
    const result = await verifyStaticFramesSafe(
      session,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      staticFrames,
      fps,
      sampleCount,
    );

    expect(result.outcome).toBe("mismatch");
    expect(result.verifiedFrames.size).toBe(0);
    expect(result.badFrame).toBe(changeAt);
  });

  it("uses silent verification seeks and restores the playhead to frame zero", async () => {
    const seekCalls: Array<{ t: number; options?: { suppressEvents?: boolean } }> = [];
    const page = {
      evaluate: vi.fn(async (fn: (tt: number) => void, t: number) => {
        const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
        const previousWindow = globalWithWindow.window;
        globalWithWindow.window = {
          __hf: {
            seek: (seekTime: number, options?: { suppressEvents?: boolean }) => {
              seekCalls.push({ t: seekTime, options });
            },
          },
        };
        try {
          fn(t);
        } finally {
          if (previousWindow === undefined) delete globalWithWindow.window;
          else globalWithWindow.window = previousWindow;
        }
      }),
    };
    vi.mocked(pageScreenshotCapture).mockImplementation(async () => Buffer.from("same"));

    const result = await verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      new Set([1, 2, 3]),
      fps,
      3,
    );

    expect(result.outcome).toBe("verified");
    expect(seekCalls.map((call) => Math.round(call.t * fps))).toEqual([0, 3, 0]);
    expect(seekCalls.every((call) => call.options?.suppressEvents === true)).toBe(true);
  });

  it("disarms within a wall-clock budget instead of spending minutes verifying a long static run", async () => {
    const fps = 24;
    let nowMs = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const page = {
      evaluate: vi.fn(async () => undefined),
    };
    vi.mocked(pageScreenshotCapture).mockImplementation(async () => {
      nowMs += 8_000;
      return Buffer.from("same");
    });

    // Mirrors the reported 350.35s / 23.976fps alpha composition closely:
    // ~8,400 predicted-static frames used to schedule ~352 full-page PNG
    // screenshots before capture could begin.
    const staticFrames = new Set<number>();
    for (let frame = 1; frame < 8_400; frame++) staticFrames.add(frame);

    const result = await verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      staticFrames,
      fps,
      24,
    );
    nowSpy.mockRestore();

    expect(result.outcome).toBe("time_budget");
    expect(result.verifiedFrames.size).toBe(0);
    expect(pageScreenshotCapture).toHaveBeenCalledTimes(2);
  });
});

describe("composition-wide static verification planner", () => {
  function framesForRuns(runs: Array<[number, number]>): Set<number> {
    return new Set(runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)));
  }

  function trackedPage(fps = 30) {
    const cursor = { frame: 0 };
    const page = {
      evaluate: vi.fn(async (_fn: unknown, time: number) => {
        cursor.frame = Math.round(time * fps);
      }),
    };
    return { cursor, page };
  }

  function verifyTwoRuns(
    page: ReturnType<typeof trackedPage>["page"],
    dependencies: Parameters<typeof verifyStaticFramesSafe>[5],
  ) {
    return verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      framesForRuns([
        [1, 3],
        [10, 12],
      ]),
      30,
      1,
      dependencies,
    );
  }

  it("keeps endpoints, a 24-frame max gap, a global floor, and monotonic samples", () => {
    const frames = framesForRuns([
      [1, 100],
      [110, 150],
    ]);
    const low = planStaticVerification(frames, 5);
    const high = planStaticVerification(frames, 12);
    expect(low.plannedComparisons).toBeGreaterThanOrEqual(5);
    expect(high.plannedComparisons).toBeGreaterThanOrEqual(12);
    for (const run of low.runs) {
      const points = [run.anchor, ...run.comparisons];
      expect(run.comparisons.at(-1)).toBe(run.b);
      expect(Math.max(...points.slice(1).map((point, i) => point - points[i]))).toBeLessThanOrEqual(
        24,
      );
      const highRun = high.runs.find((candidate) => candidate.a === run.a);
      expect(highRun).toBeDefined();
      expect(run.comparisons.every((point) => highRun?.comparisons.includes(point))).toBe(true);
    }
  });

  it("clamps an extreme global sample request to the screenshot-cap-derived bound", () => {
    const result = planStaticVerification(framesForRuns([[1, 1_000]]), 20_000);
    expect(result.effectiveSampleFloor).toBe(50);
    expect(result.plannedComparisons).toBe(50);
  });

  it("caption-heavy verification stays within budget and still detects drift", () => {
    const staticFrames = new Set<number>();
    let cursor = 1;
    for (const length of [...Array(86).fill(5), ...Array(34).fill(4), 3, 1]) {
      for (let offset = 0; offset < length; offset++) staticFrames.add(cursor + offset);
      cursor += length + 1;
    }

    const result = planStaticVerification(staticFrames, 24);

    expect(result.predictedFrames).toBe(570);
    expect(result.runs).toHaveLength(121);
    expect(result.plannedAnchors).toBe(121);
    expect(result.plannedComparisons).toBe(121);
    expect(result.plannedScreenshots).toBe(242);
    expect(result.verifiedCandidateFrames).toBe(569);
    expect(result.skippedRuns).toEqual([
      expect.objectContaining({ reason: "unprofitable", a: expect.any(Number) }),
    ]);
    expect(
      result.runs.every(
        (run: { comparisons: number[]; b: number }) => run.comparisons.at(-1) === run.b,
      ),
    ).toBe(true);
  });

  it("arms only completely verified runs when the wall budget expires", async () => {
    let nowMs = 0;
    const { cursor, page } = trackedPage();
    const result = await verifyTwoRuns(page, {
      now: () => nowMs,
      capture: async () => {
        nowMs += 5_000;
        return Buffer.from(`frame-${cursor.frame <= 3 ? 0 : 9}`);
      },
    });
    expect(result.outcome).toBe("time_budget");
    expect([...result.verifiedFrames]).toEqual([1, 2, 3]);
    expect(result.stats.completedRuns).toBe(1);
  });

  it("reports count-budget exhaustion before screenshot 401", async () => {
    const runs = Array.from({ length: 201 }, (_, index): [number, number] => {
      const start = index * 4 + 1;
      return [start, start + 2];
    });
    const page = { evaluate: vi.fn(async () => undefined) };
    const result = await verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      framesForRuns(runs),
      30,
      1,
      { now: () => 0, capture: async () => Buffer.from("same") },
    );
    expect(result.outcome).toBe("count_budget");
    expect(result.stats.screenshots).toBe(400);
    expect(result.stats.completedRuns).toBe(200);
    expect(result.verifiedFrames.size).toBe(600);
  });

  it("classifies an all-unprofitable plan without claiming budget exhaustion", async () => {
    const page = { evaluate: vi.fn(async () => undefined) };
    const result = await verifyStaticFramesSafe(
      { options: {} } as unknown as CaptureSession,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      new Set([1]),
      30,
      24,
    );
    expect(result.outcome).toBe("unprofitable");
    expect(result.verifiedFrames.size).toBe(0);
    expect(result.stats.plannedRuns).toBe(0);
  });

  it.each([
    ["mismatch" as const, false],
    ["infrastructure" as const, true],
  ])("clears earlier verified runs on %s", async (expectedOutcome, throwCapture) => {
    const { cursor, page } = trackedPage();
    const result = await verifyTwoRuns(page, {
      capture: async () => {
        if (cursor.frame === 12 && throwCapture) throw new Error("capture failed");
        if (cursor.frame === 12) return Buffer.from("drift");
        return Buffer.from(cursor.frame <= 3 ? "first" : "second");
      },
    });
    expect(result.outcome).toBe(expectedOutcome);
    expect(result.verifiedFrames.size).toBe(0);
    expect(result.stats.verifiedFrames).toBe(0);
    expect(result.stats.unverifiedFrames).toBe(result.stats.predictedFrames);
  });
});
