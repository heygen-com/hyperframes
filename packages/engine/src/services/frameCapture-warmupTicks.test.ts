/**
 * Tests for the `driveWarmupTicks` BeginFrame warmup driver.
 *
 * The wall-clock warmup loop in `initializeSession` accumulates a different
 * number of ticks per host CPU speed, which shifts `beginFrameTimeTicks`
 * and breaks byte-identical captures across distributed workers.
 *
 * `lockWarmupTicks=true` clamps the loop to a fixed iteration count
 * (`LOCKED_WARMUP_TICKS = 60`) so the baseline becomes host-independent.
 */

import { describe, expect, it } from "vitest";
import {
  LOCKED_WARMUP_TICKS,
  deriveBeginFrameTimelineTicks,
  deriveBeginFrameTimeTicks,
  driveWarmupTicks,
  prepareBeginFrameTimeline,
  warmupFrameTimeTicks,
  type WarmupTickState,
} from "./frameCapture.js";

function makeState(): WarmupTickState {
  return { running: true, ticks: 0 };
}

// Run the warmup driver "concurrently" with a simulated page-load that
// flips `state.running` to false after `pageLoadIterations` of the
// `tick` callback. Returns the final state.
async function runWithSimulatedPageLoad(
  lockWarmupTicks: boolean,
  pageLoadIterations: number,
  tickDelay: () => Promise<void> = () => Promise.resolve(),
): Promise<WarmupTickState> {
  const state = makeState();
  const intervalMs = 33;

  const tick = async (): Promise<void> => {
    if (state.ticks + 1 === pageLoadIterations) {
      state.running = false;
    }
    await tickDelay();
  };

  await driveWarmupTicks(
    {
      intervalMs,
      lockWarmupTicks,
      tick,
      sleep: () => Promise.resolve(),
    },
    state,
  );
  return state;
}

describe("driveWarmupTicks — unlocked", () => {
  it("stops when state.running flips false", async () => {
    const state = await runWithSimulatedPageLoad(false, 10);
    expect(state.ticks).toBe(10);
  });

  it("yields different tick counts for different simulated page-load lengths", async () => {
    const fast = await runWithSimulatedPageLoad(false, 5);
    const slow = await runWithSimulatedPageLoad(false, 50);
    expect(fast.ticks).toBe(5);
    expect(slow.ticks).toBe(50);
    expect(fast.ticks).not.toBe(slow.ticks);
  });

  it("frame time derived as ticks * intervalMs", async () => {
    const state = await runWithSimulatedPageLoad(false, 7);
    expect(warmupFrameTimeTicks(state, 33)).toBe(7 * 33);
  });

  it("does not iterate when state.running starts false", async () => {
    const state: WarmupTickState = { running: false, ticks: 0 };
    await driveWarmupTicks(
      {
        intervalMs: 33,
        lockWarmupTicks: false,
        tick: async () => {},
        sleep: () => Promise.resolve(),
      },
      state,
    );
    expect(state.ticks).toBe(0);
  });

  it("counts ticks even when tick callback throws (page not ready yet)", async () => {
    // Pre-acquisition errors are swallowed — the loop must keep spinning so
    // it can drive the page once CDP comes up.
    let stopAt = 5;
    const state = makeState();
    await driveWarmupTicks(
      {
        intervalMs: 33,
        lockWarmupTicks: false,
        tick: async () => {
          if (--stopAt <= 0) state.running = false;
          throw new Error("CDP not ready");
        },
        sleep: () => Promise.resolve(),
      },
      state,
    );
    // We don't count ticks on throw, but the loop kept running until
    // state.running flipped — so it exited cleanly.
    expect(state.running).toBe(false);
    expect(state.ticks).toBe(0);
  });
});

describe("driveWarmupTicks — locked", () => {
  it("runs exactly LOCKED_WARMUP_TICKS iterations regardless of state.running", async () => {
    // Simulate a fast page load: state.running flips false after just 5 ticks.
    // The locked loop must still run to LOCKED_WARMUP_TICKS.
    const state = await runWithSimulatedPageLoad(true, 5);
    expect(state.ticks).toBe(LOCKED_WARMUP_TICKS);
  });

  it("runs exactly LOCKED_WARMUP_TICKS iterations on slow simulated load", async () => {
    // state.running stays true past the locked count — loop still stops at
    // LOCKED_WARMUP_TICKS.
    const state = await runWithSimulatedPageLoad(true, 9999);
    expect(state.ticks).toBe(LOCKED_WARMUP_TICKS);
  });

  it("yields IDENTICAL tick counts across simulated fast and slow loads", async () => {
    // THE determinism property the locked mode exists for.
    const fast = await runWithSimulatedPageLoad(true, 5);
    const slow = await runWithSimulatedPageLoad(true, 200);
    expect(fast.ticks).toBe(slow.ticks);
    expect(fast.ticks).toBe(LOCKED_WARMUP_TICKS);
    expect(warmupFrameTimeTicks(fast, 33)).toBe(warmupFrameTimeTicks(slow, 33));
  });

  it("yields LOCKED_WARMUP_TICKS even when state.running starts false", async () => {
    // Guards the locked contract independently of the caller's running flag.
    const state: WarmupTickState = { running: false, ticks: 0 };
    await driveWarmupTicks(
      {
        intervalMs: 33,
        lockWarmupTicks: true,
        tick: async () => {},
        sleep: () => Promise.resolve(),
      },
      state,
    );
    expect(state.ticks).toBe(LOCKED_WARMUP_TICKS);
  });

  it("does not exceed LOCKED_WARMUP_TICKS even if the caller never stops it", async () => {
    const state = makeState();
    let observedMax = 0;
    await driveWarmupTicks(
      {
        intervalMs: 33,
        lockWarmupTicks: true,
        tick: async () => {
          observedMax = Math.max(observedMax, state.ticks + 1);
        },
        sleep: () => Promise.resolve(),
      },
      state,
    );
    expect(observedMax).toBe(LOCKED_WARMUP_TICKS);
    expect(state.ticks).toBe(LOCKED_WARMUP_TICKS);
  });

  it("baseline frame time matches (LOCKED_WARMUP_TICKS * intervalMs)", async () => {
    // initializeSession derives session.beginFrameTimeTicks from the final
    // tick count — locked mode pins this to a host-independent value.
    const state = await runWithSimulatedPageLoad(true, 5);
    expect(warmupFrameTimeTicks(state, 33)).toBe(LOCKED_WARMUP_TICKS * 33);
  });
});

describe("deriveBeginFrameTimeTicks", () => {
  const warmupIntervalMs = 33;
  const state: WarmupTickState = {
    running: false,
    ticks: LOCKED_WARMUP_TICKS,
  };
  const expectMonotonicTimeline = (
    warmupState: WarmupTickState,
    captureIntervalMs: number,
  ): void => {
    const timeline = deriveBeginFrameTimelineTicks(
      warmupState,
      warmupIntervalMs,
      captureIntervalMs,
    );
    const lastWarmupTick = (warmupState.ticks - 1) * warmupIntervalMs;

    expect(timeline.commit).toBeGreaterThan(lastWarmupTick);
    expect(timeline.probe).toBeGreaterThan(timeline.commit);
    expect(timeline.capture).toBeGreaterThan(timeline.probe);
  };

  it.each([60, 120, 240, 60_000 / 1001])(
    "keeps warmup, commit, probe, and capture monotonic at %ifps",
    (fps) => {
      expectMonotonicTimeline(state, 1000 / fps);
    },
  );

  it.each([24, 30, 30_000 / 1001, 31, 32])(
    "preserves the legacy capture baseline when it is already monotonic at %ifps",
    (fps) => {
      const captureIntervalMs = 1000 / fps;

      expect(deriveBeginFrameTimeTicks(state, warmupIntervalMs, captureIntervalMs)).toBeCloseTo(
        (LOCKED_WARMUP_TICKS + 10) * captureIntervalMs,
      );
    },
  );

  it("keeps an unlocked warmup timeline monotonic", () => {
    const unlockedState: WarmupTickState = { running: false, ticks: 7 };
    expectMonotonicTimeline(unlockedState, 1000 / 60);
  });

  it("raises the capture baseline only when the warmup clock is ahead", () => {
    const captureIntervalMs = 1000 / 60;

    expect(deriveBeginFrameTimeTicks(state, warmupIntervalMs, captureIntervalMs)).toBeCloseTo(
      LOCKED_WARMUP_TICKS * warmupIntervalMs + 10 * captureIntervalMs,
    );
  });

  it("raises the baseline just above the safe legacy boundary", () => {
    const captureIntervalMs = 1000 / 33;

    expect(deriveBeginFrameTimeTicks(state, warmupIntervalMs, captureIntervalMs)).toBeCloseTo(
      LOCKED_WARMUP_TICKS * warmupIntervalMs + 10 * captureIntervalMs,
    );
  });

  it("wires the canonical capture and commit ticks into session initialization", () => {
    const session = {
      beginFrameIntervalMs: 1000 / 60,
      beginFrameTimeTicks: 0,
    };
    const prepared = prepareBeginFrameTimeline(session, state, warmupIntervalMs);

    expect(session.beginFrameTimeTicks).toBe(prepared.timeline.capture);
    expect(prepared.commitParams).toEqual({
      frameTimeTicks: prepared.timeline.commit,
      interval: session.beginFrameIntervalMs,
      noDisplayUpdates: false,
    });
    expect(prepared.timeline.commit).toBeGreaterThan((LOCKED_WARMUP_TICKS - 1) * warmupIntervalMs);
  });
});
