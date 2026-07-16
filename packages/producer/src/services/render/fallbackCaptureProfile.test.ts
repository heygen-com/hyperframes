/**
 * Tests for the `capture_fallback_profile` observability emission — the
 * diagnostic surface introduced with the fast-capture fallback profiling
 * PR.
 *
 * Contract we're pinning here:
 *   1. Env off (default) → no emission, regardless of whether the fallback
 *      fired. Healthy renders and consumers that don't subscribe to the
 *      diagnostic pay zero cost.
 *   2. Env on + fallback fired → one checkpoint per fallback-engaged
 *      session, with the shape the framing doc promises:
 *      stagePhase / triggerReason / frameCount / captureTime{P50,P95,P99}Ms /
 *      captureTimeAvgTotalMs.
 *   3. Env on + fallback did NOT fire → no emission (drawElement renders
 *      stay clean).
 *   4. Multi-worker sessions produce multiple checkpoints (one per
 *      fallback-engaged perf summary).
 *   5. Full trigger fidelity (filter:blur vs filter:drop-shadow) is
 *      preserved into the `triggerReason` field — the whole point of
 *      the new `deFallbackTrigger` engine field.
 */

import type { CapturePerfSummary } from "@hyperframes/engine";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_PROFILE_ENV_VAR, emitFallbackCaptureProfile } from "./fallbackCaptureProfile.js";
import { RenderObservabilityRecorder } from "./observability.js";

function makeLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeRecorder(): {
  recorder: RenderObservabilityRecorder;
  log: ReturnType<typeof makeLog>;
} {
  const log = makeLog();
  const recorder = new RenderObservabilityRecorder({
    pipelineStartMs: Date.now(),
    log,
    renderJobId: "render-fallback-profile",
  });
  return { recorder, log };
}

/**
 * Build a `CapturePerfSummary` with fallback-engaged fields set. The
 * emitter reads `deFallbackTrigger` (preferred), `deGateReason`, `frames`,
 * `p50TotalMs`, `p95TotalMs`, `p99TotalMs`, `avgTotalMs` — everything else
 * can be zeroed out.
 */
function fallbackPerf(overrides: Partial<CapturePerfSummary>): CapturePerfSummary {
  return {
    frames: 180,
    avgTotalMs: 45,
    avgSeekMs: 0,
    avgBeforeCaptureMs: 0,
    avgScreenshotMs: 45,
    p50TotalMs: 42,
    p95TotalMs: 68,
    p99TotalMs: 95,
    staticDedupReused: 0,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    staticDedupPredicted: 0,
    captureMode: "screenshot",
    deGateReason: "css_effect:filter",
    deFallbackTrigger: "filter:blur",
    deWorkerEncode: false,
    deVerifyArmed: 0,
    deVerifyInitMs: 0,
    deBoundaryFrames: 0,
    deNcprFallbacks: 0,
    ...overrides,
  };
}

/**
 * A `CapturePerfSummary` where drawElement ran end-to-end — no fallback
 * fields set. The emitter should treat this as a no-op regardless of env.
 */
function drawElementPerf(overrides: Partial<CapturePerfSummary> = {}): CapturePerfSummary {
  return {
    frames: 180,
    avgTotalMs: 12,
    avgSeekMs: 0,
    avgBeforeCaptureMs: 0,
    avgScreenshotMs: 0,
    p50TotalMs: 10,
    p95TotalMs: 20,
    p99TotalMs: 25,
    staticDedupReused: 0,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    staticDedupPredicted: 0,
    captureMode: "drawelement",
    // deGateReason and deFallbackTrigger intentionally absent — drawElement ran.
    deWorkerEncode: true,
    deVerifyArmed: 3,
    deVerifyInitMs: 400,
    deBoundaryFrames: 0,
    deNcprFallbacks: 0,
    ...overrides,
  };
}

function findFallbackCheckpoints(log: ReturnType<typeof makeLog>) {
  return log.info.mock.calls.filter(
    ([message, meta]) =>
      message === "[Render:trace]" &&
      typeof meta === "object" &&
      meta !== null &&
      "phase" in meta &&
      meta.phase === "capture_fallback_profile",
  );
}

describe("emitFallbackCaptureProfile", () => {
  it("emits nothing when HF_PROFILE_FALLBACK_CAPTURE is unset, even if the fallback fired", () => {
    const { recorder, log } = makeRecorder();
    const emitted = emitFallbackCaptureProfile(recorder, [fallbackPerf({})], {});
    expect(emitted).toBe(0);
    expect(findFallbackCheckpoints(log)).toHaveLength(0);
  });

  it("emits nothing when HF_PROFILE_FALLBACK_CAPTURE is anything other than 'true'", () => {
    const { recorder, log } = makeRecorder();
    for (const value of ["1", "yes", "on", "false", ""]) {
      emitFallbackCaptureProfile(recorder, [fallbackPerf({})], {
        [FALLBACK_PROFILE_ENV_VAR]: value,
      });
    }
    expect(findFallbackCheckpoints(log)).toHaveLength(0);
  });

  it("emits nothing when env is on but no session engaged the fallback path", () => {
    const { recorder, log } = makeRecorder();
    const emitted = emitFallbackCaptureProfile(recorder, [drawElementPerf(), drawElementPerf()], {
      [FALLBACK_PROFILE_ENV_VAR]: "true",
    });
    expect(emitted).toBe(0);
    expect(findFallbackCheckpoints(log)).toHaveLength(0);
  });

  it("emits ONE checkpoint per fallback-engaged perf summary when env is on", () => {
    const { recorder, log } = makeRecorder();
    const emitted = emitFallbackCaptureProfile(
      recorder,
      [
        fallbackPerf({ deFallbackTrigger: "filter:blur", frames: 180 }),
        drawElementPerf(),
        fallbackPerf({ deFallbackTrigger: "filter:drop-shadow", frames: 120 }),
      ],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    expect(emitted).toBe(2);
    const checkpoints = findFallbackCheckpoints(log);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.[1]).toEqual(
      expect.objectContaining({
        phase: "capture_fallback_profile",
        status: "checkpoint",
        stagePhase: "fallback-capture",
        triggerReason: "filter:blur",
        frameCount: 180,
      }),
    );
    expect(checkpoints[1]?.[1]).toEqual(
      expect.objectContaining({
        phase: "capture_fallback_profile",
        stagePhase: "fallback-capture",
        triggerReason: "filter:drop-shadow",
        frameCount: 120,
      }),
    );
  });

  it("emits the full percentile shape (p50/p95/p99 + avg + total)", () => {
    const { recorder, log } = makeRecorder();
    emitFallbackCaptureProfile(
      recorder,
      [
        fallbackPerf({
          frames: 180,
          p50TotalMs: 42,
          p95TotalMs: 68,
          p99TotalMs: 95,
          avgTotalMs: 45,
        }),
      ],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    const checkpoint = findFallbackCheckpoints(log)[0];
    expect(checkpoint?.[1]).toEqual(
      expect.objectContaining({
        frameCount: 180,
        captureTimeP50Ms: 42,
        captureTimeP95Ms: 68,
        captureTimeP99Ms: 95,
        captureTimeAvgTotalMs: 45,
      }),
    );
  });

  it("prefers deFallbackTrigger over deGateReason for the triggerReason field", () => {
    const { recorder, log } = makeRecorder();
    emitFallbackCaptureProfile(
      recorder,
      [
        fallbackPerf({
          deGateReason: "css_effect:filter", // sanitized low-cardinality bucket
          deFallbackTrigger: "filter:drop-shadow", // full-fidelity trigger
        }),
      ],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    const checkpoint = findFallbackCheckpoints(log)[0];
    // The full-fidelity trigger wins — the whole point of the new field.
    expect(checkpoint?.[1]).toEqual(
      expect.objectContaining({ triggerReason: "filter:drop-shadow" }),
    );
  });

  it("falls back to deGateReason when deFallbackTrigger is absent", () => {
    const { recorder, log } = makeRecorder();
    emitFallbackCaptureProfile(
      recorder,
      [
        fallbackPerf({
          deGateReason: "at_risk_timeline",
          deFallbackTrigger: undefined,
        }),
      ],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    const checkpoint = findFallbackCheckpoints(log)[0];
    expect(checkpoint?.[1]).toEqual(expect.objectContaining({ triggerReason: "at_risk_timeline" }));
  });

  it("tags the trigger in the human-readable message alongside the structured field", () => {
    const { recorder, log } = makeRecorder();
    emitFallbackCaptureProfile(recorder, [fallbackPerf({ deFallbackTrigger: "filter:blur" })], {
      [FALLBACK_PROFILE_ENV_VAR]: "true",
    });
    const checkpoint = findFallbackCheckpoints(log)[0];
    expect(checkpoint?.[1]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("filter:blur") as unknown as string,
      }),
    );
  });

  it("emits per-render on repeated invocations — each render call yields its own set", () => {
    // Multi-composition batches share a recorder across compositions? No — each
    // composition gets its own RenderObservabilityRecorder. Simulate a second
    // render's recorder to prove there's no shared static state.
    const first = makeRecorder();
    emitFallbackCaptureProfile(
      first.recorder,
      [fallbackPerf({ deFallbackTrigger: "filter:blur" })],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    expect(findFallbackCheckpoints(first.log)).toHaveLength(1);

    const second = makeRecorder();
    emitFallbackCaptureProfile(
      second.recorder,
      [fallbackPerf({ deFallbackTrigger: "filter:drop-shadow" })],
      { [FALLBACK_PROFILE_ENV_VAR]: "true" },
    );
    expect(findFallbackCheckpoints(second.log)).toHaveLength(1);
    // The first recorder didn't get the second render's emission bleeding in.
    expect(findFallbackCheckpoints(first.log)).toHaveLength(1);
  });
});
