import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderTooSlowError, checkRenderEta, startRenderEtaGuard } from "./renderEtaGuard.js";

const RENDER_TOO_SLOW = "RENDER_TOO_SLOW";

describe("checkRenderEta", () => {
  const base = { maxRenderMs: 100_000, elapsedMs: 0, framesCompleted: 0, totalFrames: 100 };

  it("passes at the 1.2x margin and fails just over it", () => {
    expect(checkRenderEta("capture", { ...base, msPerFrame: 1_200 })).toBeUndefined();
    const error = checkRenderEta("capture", { ...base, msPerFrame: 1_201 });
    expect(error).toBeInstanceOf(RenderTooSlowError);
    expect(error?.message).toMatch(/^render too slow:/);
    expect(error?.publicMetadata).toMatchObject({ stage: "capture", etaMs: 120_100 });
    // The producer server reads these off the error to build the wire envelope.
    expect(error?.code).toBe(RENDER_TOO_SLOW);
    expect(error?.owner).toBe("user");
    expect(error?.retryable).toBe(false);
  });

  it("counts time already spent", () => {
    expect(
      checkRenderEta("capture", { ...base, elapsedMs: 30_000, msPerFrame: 1_000 }),
    ).toBeInstanceOf(RenderTooSlowError);
  });

  it("never fires without a budget or without an estimate", () => {
    expect(
      checkRenderEta("capture", { ...base, maxRenderMs: undefined, msPerFrame: 1e9 }),
    ).toBeUndefined();
    expect(checkRenderEta("capture", { ...base, maxRenderMs: 0, msPerFrame: 1e9 })).toBeUndefined();
    expect(checkRenderEta("capture", { ...base, msPerFrame: 0 })).toBeUndefined();
  });

  it("matches the two prod renders on the 90 minute budget", () => {
    const budget = 90 * 60_000;
    // 21540 frames, 4 workers, p95 784 ms: the calibration estimate (70 min) is under budget.
    expect(
      checkRenderEta("capture_calibration", {
        maxRenderMs: budget,
        elapsedMs: 0,
        framesCompleted: 0,
        totalFrames: 21_540,
        msPerFrame: 784 / 4,
      }),
    ).toBeUndefined();
    // 570 frames, 1 worker, p95 15.8 s: 150 min, caught before capture.
    expect(
      checkRenderEta("capture_calibration", {
        maxRenderMs: budget,
        elapsedMs: 600_000,
        framesCompleted: 0,
        totalFrames: 570,
        msPerFrame: 15_800 / 1,
      }),
    ).toBeInstanceOf(RenderTooSlowError);
  });
});

describe("startRenderEtaGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Advances 5 s per step, adding `framesPerStep` frames, until tripped or `steps` run out. */
  function run(opts: {
    maxRenderMs?: number;
    framesPerStep: number;
    steps: number;
    total: number;
  }) {
    const job = { framesRendered: 0 };
    let tripped: RenderTooSlowError | undefined;
    const stop = startRenderEtaGuard({
      maxRenderMs: opts.maxRenderMs,
      job,
      totalFrames: opts.total,
      pipelineStartMs: Date.now(),
      onTooSlow: (error) => (tripped = error),
    });
    let at = 0;
    for (let i = 0; i < opts.steps && !tripped; i++) {
      job.framesRendered += opts.framesPerStep;
      vi.advanceTimersByTime(5_000);
      at += 5_000;
    }
    stop();
    return { tripped, at, job };
  }

  it("fails a crawling render within about two minutes of capture", () => {
    const { tripped, at } = run({
      maxRenderMs: 120_000,
      framesPerStep: 1,
      steps: 100,
      total: 1_000,
    });
    expect(tripped?.message).toMatch(/^render too slow:/);
    expect(at).toBeLessThanOrEqual(120_000);
    expect(tripped?.publicMetadata).toMatchObject({
      stage: "capture",
      totalFrames: 1_000,
      maxRenderMs: 120_000,
    });
  });

  it("leaves a render that will finish inside the budget alone", () => {
    expect(
      run({ maxRenderMs: 10_000_000, framesPerStep: 100, steps: 100, total: 100_000 }).tripped,
    ).toBeUndefined();
  });

  it("is never tripped by the encode and assemble time after capture completes", () => {
    const job = { framesRendered: 0 };
    const onTooSlow = vi.fn();
    const stop = startRenderEtaGuard({
      maxRenderMs: 120_000,
      job,
      totalFrames: 100,
      pipelineStartMs: Date.now(),
      onTooSlow,
    });
    // Capture finishes inside the budget...
    for (let i = 0; i < 10; i++) {
      job.framesRendered += 10;
      vi.advanceTimersByTime(5_000);
    }
    // ...then a mux that runs for an hour with the counter parked at the total.
    vi.advanceTimersByTime(60 * 60_000);
    stop();
    expect(onTooSlow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is a no-op without a budget", () => {
    expect(
      run({ maxRenderMs: undefined, framesPerStep: 1, steps: 200, total: 1_000 }).tripped,
    ).toBeUndefined();
    expect(
      run({ maxRenderMs: 0, framesPerStep: 1, steps: 200, total: 1_000 }).tripped,
    ).toBeUndefined();
  });

  it("does not decide on zero frames (the stall watchdog owns that)", () => {
    expect(
      run({ maxRenderMs: 1_000, framesPerStep: 0, steps: 200, total: 1_000 }).tripped,
    ).toBeUndefined();
  });
});
