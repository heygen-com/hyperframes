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
