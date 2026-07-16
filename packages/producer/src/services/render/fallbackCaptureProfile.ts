import type { CapturePerfSummary } from "@hyperframes/engine";
import type { RenderObservabilityRecorder } from "./observability.js";

/**
 * Opt-in per-frame timing summary emitted through the observability channel
 * whenever a render's capture ran on the FAST-CAPTURE FALLBACK path
 * (drawElement gated off → screenshot capture engaged).
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Field-signal baseline from `#hyperframes-cli-feedback` cron sweeps: on
 * darwin/arm64 alone we see ≥2 fast-capture fallbacks/hr triggered by
 * `filter:blur` / `filter:drop-shadow`. That is documented and correct
 * behavior — drawElement can't reproduce those CSS effects and bails to
 * screenshot per `packages/engine/docs/fast-capture-limitations.md` — but the
 * fallback path's per-frame perf is currently *untimed* end-to-end. Session
 * state carries `capturePerf.frameMs` and `getCapturePerfSummary()` emits a
 * `p50TotalMs`, but no tail (p95/p99) and no per-render summary keyed on the
 * specific trigger reaches downstream telemetry. Without that we can't
 * characterize whether the fallback is a 10% tax or a 10× cliff — every
 * future perf discussion is guesswork.
 *
 * ── What this emits ────────────────────────────────────────────────────────
 * A single `capture_fallback_profile` checkpoint per render, per session that
 * hit the fallback, containing:
 *  • `stagePhase: "fallback-capture"` — string tag consumers can match on;
 *  • `frameCount` — captured frames on this session's fallback path;
 *  • `captureTimeP50Ms` / `captureTimeP95Ms` / `captureTimeP99Ms` — nearest-rank
 *    per-frame capture-time percentiles (from `capturePerf.frameMs`);
 *  • `captureTimeTotalMs` — cumulative session capture time
 *    (session.capturePerf.totalMs);
 *  • `message` — human-readable diagnostic prefix incorporating the trigger.
 *
 * Uses the SAME `RenderObservabilityRecorder.checkpoint()` primitive that
 * `observeRenderStage` heartbeats and `stageStart`/`stageEnd` use (introduced
 * in PR #2510). No new telemetry channel, no new sink.
 *
 * ── Why opt-in ────────────────────────────────────────────────────────────
 * The percentile computation itself is trivially cheap (one sort per
 * session), but *emitting* structured records into the observability stream
 * is a downstream-consumer decision — enterprises that don't route
 * `capture_fallback_profile` events shouldn't see unfamiliar phase names in
 * their trace pipeline. `HF_PROFILE_FALLBACK_CAPTURE=true` lets operators
 * opt into the diagnostic surface. Default off preserves current-shape
 * telemetry for every caller that hasn't asked for the new signal.
 *
 * ── What this ISN'T ────────────────────────────────────────────────────────
 * A perf fix. A behavior change on healthy paths. A new metric pipeline. It
 * is *diagnostic groundwork*: once operators can collect real-world
 * p50/p95/p99 keyed on the exact CSS trigger, we can decide whether the
 * fallback-path perf is a design-decision-to-revisit or an acceptable
 * trade-off. That decision is out of scope here.
 */

/** Env var operators set to opt into the diagnostic emission. */
export const FALLBACK_PROFILE_ENV_VAR = "HF_PROFILE_FALLBACK_CAPTURE";

/**
 * Fallback path is considered "engaged" when EITHER a specific fallback
 * trigger was recorded (populated at every fallback-gate branch alongside
 * `deGateReason`) OR the engine's low-cardinality gate reason is set. Both
 * conditions cover the same set today; checking both defends against a
 * future gate that populates one but not the other.
 */
function fallbackEngaged(perf: CapturePerfSummary): boolean {
  return Boolean(perf.deFallbackTrigger) || Boolean(perf.deGateReason);
}

/**
 * Resolve the trigger string to emit. Prefers the full-fidelity
 * {@link CapturePerfSummary.deFallbackTrigger} (e.g. `"filter:blur"`) so
 * downstream consumers can distinguish `blur` from `drop-shadow`; falls back
 * to the low-cardinality {@link CapturePerfSummary.deGateReason} when the
 * fine-grained field is absent (defensive: unreachable in the shipping
 * engine, but keeps the emitter total).
 */
function resolveTrigger(perf: CapturePerfSummary): string {
  return perf.deFallbackTrigger ?? perf.deGateReason ?? "unknown";
}

/**
 * Emit a `capture_fallback_profile` checkpoint per fallback-engaged capture
 * summary. No-op when the env var is not `"true"` (default) or when the
 * summary set has no fallback-engaged entries.
 *
 * Multi-composition batches produce multiple {@link CapturePerfSummary} in
 * `perfSummaries` (one per worker session). Each fallback-engaged summary
 * gets its own checkpoint — the emitter is *per-session*, not *per-render*
 * — so cross-session divergence (e.g. one worker gated by `filter:blur`,
 * another by `at_risk_timeline`) is visible individually. Downstream
 * consumers can aggregate as needed.
 *
 * @param recorder Observability recorder for the current render.
 * @param perfSummaries `CapturePerfSummary` collected from capture-stage sessions.
 * @param env Env-var view (defaults to `process.env`) — injected for tests.
 * @returns Count of checkpoints emitted (0 when opt-in is off or no fallback fired).
 */
export function emitFallbackCaptureProfile(
  recorder: RenderObservabilityRecorder,
  perfSummaries: readonly CapturePerfSummary[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  if (env[FALLBACK_PROFILE_ENV_VAR] !== "true") return 0;
  let emitted = 0;
  for (const perf of perfSummaries) {
    if (!fallbackEngaged(perf)) continue;
    const trigger = resolveTrigger(perf);
    recorder.checkpoint("capture_fallback_profile", `fast-capture fallback profile (${trigger})`, {
      stagePhase: "fallback-capture",
      triggerReason: trigger,
      frameCount: perf.frames,
      captureTimeP50Ms: perf.p50TotalMs,
      captureTimeP95Ms: perf.p95TotalMs,
      captureTimeP99Ms: perf.p99TotalMs,
      captureTimeAvgTotalMs: perf.avgTotalMs,
    });
    emitted++;
  }
  return emitted;
}
