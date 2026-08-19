import { describe, expect, it } from "vitest";
import type { RenderObservabilitySummary } from "@hyperframes/producer";
import { renderObservabilityTelemetryPayload } from "./renderObservability.js";

function makeSummary(
  capture: Partial<RenderObservabilitySummary["capture"]>,
): RenderObservabilitySummary {
  return {
    events: [],
    eventCount: 0,
    browserDiagnostics: {
      total: 0,
      errors: 0,
      pageErrors: 0,
      requestFailed: 0,
      httpErrors: 0,
      navigationStarts: 0,
      navigationFailures: 0,
      consoleErrors: 0,
      consoleWarnings: 0,
    },
    capture: { forceScreenshot: false, captureMode: "beginframe", ...capture },
  };
}

describe("renderObservabilityTelemetryPayload — render-reliability counters", () => {
  it("maps the transient-retry and OOM counters through to the telemetry payload", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ transientRetries: 2, memoryExhaustionDetected: true }),
    );
    expect(payload.captureTransientRetries).toBe(2);
    expect(payload.captureMemoryExhaustionDetected).toBe(true);
  });

  it("leaves the counters undefined when the render didn't retry or OOM", () => {
    const payload = renderObservabilityTelemetryPayload(makeSummary({}));
    expect(payload.captureTransientRetries).toBeUndefined();
    expect(payload.captureMemoryExhaustionDetected).toBeUndefined();
  });
});

describe("renderObservabilityTelemetryPayload — DE inversion/router cohort (failure-path visibility)", () => {
  it("maps the router cohort and its pre-router worker count", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ deParallelRouter: "routed", dePreRouterWorkers: 2 }),
    );
    expect(payload.captureDeParallelRouter).toBe("routed");
    expect(payload.captureDePreRouterWorkers).toBe(2);
    expect(payload.captureDeWorkerInversion).toBeUndefined();
    expect(payload.captureDePreInversionWorkers).toBeUndefined();
  });

  it("maps the inversion cohort and its pre-inversion worker count", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ deWorkerInversion: "inverted", dePreInversionWorkers: 4 }),
    );
    expect(payload.captureDeWorkerInversion).toBe("inverted");
    expect(payload.captureDePreInversionWorkers).toBe(4);
    expect(payload.captureDeParallelRouter).toBeUndefined();
  });

  it("carries deSelfVerifyFallback so a hard failure mid-verify is still visible", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ deParallelRouter: "routed", deSelfVerifyFallback: true }),
    );
    expect(payload.captureDeSelfVerifyFallback).toBe(true);
  });

  it("carries deFallbackReason so a render that fails AFTER an OOM-triggered fallback attempt is distinguishable from one that never attempted a fallback", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({
        deParallelRouter: "routed",
        deSelfVerifyFallback: false,
        deFallbackReason: "oom",
      }),
    );
    expect(payload.captureDeFallbackReason).toBe("oom");
  });

  it("leaves deFallbackReason undefined when no fallback was ever attempted", () => {
    const payload = renderObservabilityTelemetryPayload(makeSummary({}));
    expect(payload.captureDeFallbackReason).toBeUndefined();
  });

  it("carries the failing dB, frame index, and threshold for a psnr fallback, still visible on a hard failure", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({
        deParallelRouter: "routed",
        deFallbackReason: "psnr",
        deFallbackFailedDb: 28.4,
        deFallbackFrameIndex: 649,
        deFallbackThresholdDb: 32,
      }),
    );
    expect(payload.captureDeFallbackFailedDb).toBe(28.4);
    expect(payload.captureDeFallbackFrameIndex).toBe(649);
    expect(payload.captureDeFallbackThresholdDb).toBe(32);
  });

  it("leaves failedDb/thresholdDb undefined for a blank/oom/capture_error fallback (no PSNR score exists)", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ deFallbackReason: "oom", deFallbackFrameIndex: undefined }),
    );
    expect(payload.captureDeFallbackFailedDb).toBeUndefined();
    expect(payload.captureDeFallbackFrameIndex).toBeUndefined();
    expect(payload.captureDeFallbackThresholdDb).toBeUndefined();
  });
});

describe("renderObservabilityTelemetryPayload — non-DE parallel-stream router", () => {
  it("maps the router outcome", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ captureParallelStream: "beginframe" }),
    );
    expect(payload.captureParallelStream).toBe("beginframe");
  });

  it("maps the passive eligible_off cohort-sizing signal", () => {
    const payload = renderObservabilityTelemetryPayload(
      makeSummary({ captureParallelStream: "eligible_off" }),
    );
    expect(payload.captureParallelStream).toBe("eligible_off");
  });

  it("stays undefined when the router never fired", () => {
    const payload = renderObservabilityTelemetryPayload(makeSummary({}));
    expect(payload.captureParallelStream).toBeUndefined();
  });
});
