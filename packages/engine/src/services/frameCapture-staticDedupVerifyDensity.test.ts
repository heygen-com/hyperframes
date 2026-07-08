import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeStaticVerificationPoints,
  verifyStaticFramesSafe,
  type CaptureSession,
} from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./screenshotService.js")>();
  return { ...actual, pageScreenshotCapture: vi.fn() };
});

/**
 * Regression lock for static-dedup verification sample density.
 *
 * The prior formula capped points-per-run at a flat `min(sampleCount, 8)`,
 * so the stride between checks grew linearly with the run's span — a run of
 * a few thousand frames could end up with checks hundreds of frames apart.
 * A genuine content change hiding between two such checks (e.g. text
 * swapped by a mechanism the GSAP tween walk in computeStaticFrameSet can't
 * see) would never get sampled, and the run would be wrongly trusted as
 * static.
 *
 * A first version of this fix bounded the STRIDE by `sampleCount` directly —
 * which fixed the density but inverted the config knob's polarity: raising
 * `HF_STATIC_DEDUP_SAMPLES` widened the allowed gap instead of shrinking it.
 * The current formula uses a fixed internal reference stride (independent of
 * sampleCount) for the length-scaling fix, and sampleCount as a pure
 * point-count floor that only ever increases density.
 */
describe("computeStaticVerificationPoints", () => {
  const REFERENCE_STRIDE = 24; // matches STATIC_VERIFY_REFERENCE_STRIDE in frameCapture.ts

  function maxGap(points: number[]): number {
    let max = 0;
    for (let i = 1; i < points.length; i++) max = Math.max(max, points[i] - points[i - 1]);
    return max;
  }

  it("never leaves a gap wider than the reference stride on a long run, even with a low sampleCount", () => {
    // Pre-fix (flat 8-point cap): stride = floor(2000/7) = 285. Using a LOW
    // sampleCount (5) here proves the length-scaling fix is independent of the
    // user's sampleCount setting, not just true when sampleCount happens to be large.
    const points = computeStaticVerificationPoints(0, 2000, 5);
    expect(maxGap(points)).toBeLessThanOrEqual(REFERENCE_STRIDE);
  });

  it("scales point count up further for an even longer run", () => {
    const points = computeStaticVerificationPoints(0, 10_000, 24);
    expect(maxGap(points)).toBeLessThanOrEqual(REFERENCE_STRIDE);
    expect(points.length).toBeGreaterThan(400);
  });

  it("raising sampleCount only ever increases density (never decreases it)", () => {
    // A prior version of this fix used sampleCount as a stride CAP, so raising
    // it widened the allowed gap instead of narrowing it. Once sampleCount
    // exceeds the length-scaled floor, it must now visibly tighten the gap.
    const lowSample = computeStaticVerificationPoints(0, 2000, 24);
    const highSample = computeStaticVerificationPoints(0, 2000, 200);
    expect(maxGap(highSample)).toBeLessThan(maxGap(lowSample));
  });

  it("sampleCount still governs density on short runs where the length-scaled floor is small", () => {
    const points = computeStaticVerificationPoints(100, 150, 24);
    expect(points[0]).toBe(100);
    expect(points[points.length - 1]).toBe(150);
    // perRun = max(3, 24, ceil(50/24)+1=4) = 24 → stride = floor(50/23) = 2.
    expect(maxGap(points)).toBeLessThanOrEqual(2);
  });

  it("always includes the run's start and end", () => {
    const points = computeStaticVerificationPoints(500, 500 + 3333, 24);
    expect(points[0]).toBe(500);
    expect(points[points.length - 1]).toBe(500 + 3333);
  });

  it("handles a single-frame run without dividing by zero", () => {
    const points = computeStaticVerificationPoints(42, 42, 24);
    expect(points).toEqual([42]);
  });
});

/**
 * Behavior-level lock: a real content change that reverts before the run's end
 * (so the always-checked endpoint alone would NOT reveal it) must still be
 * caught once it falls within the new, denser sample spacing — even though the
 * old flat 8-point-per-run density would have skipped straight past it.
 */
describe("verifyStaticFramesSafe catches drift the old fixed-point density would miss", () => {
  const fps = 30;

  function oldFormulaPoints(a: number, b: number, sampleCount: number): number[] {
    const perRun = Math.max(3, Math.min(sampleCount, 8));
    const span = b - a;
    const stride = span > 0 ? Math.max(1, Math.floor(span / (perRun - 1))) : 1;
    const pts = new Set<number>();
    for (let f = a; f <= b; f += stride) pts.add(f);
    pts.add(b);
    return [...pts].sort((x, y) => x - y);
  }

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
    const oldPoints = new Set(oldFormulaPoints(a, b, sampleCount));
    const newPoints = computeStaticVerificationPoints(a, b, sampleCount);
    const changeAt = newPoints.find((f) => !oldPoints.has(f) && f !== a && f !== b);
    if (changeAt === undefined) throw new Error("test setup: no frame differs between formulas");

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

    expect(result).not.toBeNull();
    expect(result?.budgetExhausted).toBe(false);
    expect(result?.badFrame).toBe(changeAt);
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
      new Set([1, 2]),
      fps,
      3,
    );

    expect(result).toBeNull();
    expect(seekCalls.map((call) => Math.round(call.t * fps))).toEqual([0, 1, 2, 0]);
    expect(seekCalls.every((call) => call.options?.suppressEvents === true)).toBe(true);
  });
});
