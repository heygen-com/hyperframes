import { describe, expect, it, vi, beforeEach } from "vitest";

// The suppression half of the cross-process opt-out. `hyperframes preview` is
// long-lived, and Studio has no poller for /api/telemetry-identity, so a
// render that finishes AFTER `hyperframes telemetry disable` ran in another
// terminal used to report its outcome anyway: shouldTrack() had cached `true`
// at boot and nothing ever asked again.
//
// This pins the mechanism the render-outcome path depends on — refresh, then
// emit — at the layer where the event is actually dropped.

vi.stubEnv("HYPERFRAMES_NO_TELEMETRY", "");
vi.stubEnv("DO_NOT_TRACK", "");

const configState = { telemetryEnabled: true };
vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: "anon-1", telemetryEnabled: configState.telemetryEnabled }),
  writeConfig: () => {},
}));
vi.mock("../utils/env.js", () => ({ isDevMode: () => false }));
vi.mock("./canary.js", () => ({ canaryEventProperties: () => ({}) }));

const enqueue = vi.fn();
vi.mock("./transport.js", () => ({
  enqueue: (...args: unknown[]) => enqueue(...args),
  flush: vi.fn(),
  flushSync: vi.fn(),
}));

const { trackEvent, resetTelemetryPostureCache, shouldTrack } = await import("./client.js");

beforeEach(() => {
  configState.telemetryEnabled = true;
  enqueue.mockClear();
  resetTelemetryPostureCache();
});

describe("telemetry posture refresh", () => {
  it("stops emitting once another process disables telemetry", () => {
    trackEvent("render_complete", {});
    expect(enqueue).toHaveBeenCalledTimes(1);

    // `hyperframes telemetry disable` elsewhere, mid-render.
    configState.telemetryEnabled = false;
    resetTelemetryPostureCache();

    trackEvent("render_complete", {});
    expect(enqueue, "outcome emitted after the user opted out").toHaveBeenCalledTimes(1);
  });

  // The memo is load-bearing for a CLI command — one process, one answer, asked
  // once per event. Dropping it entirely would be a per-event config read.
  it("still caches within a posture, so it is not a per-event disk read", () => {
    expect(shouldTrack()).toBe(true);
    configState.telemetryEnabled = false;
    expect(shouldTrack(), "changed without an explicit refresh").toBe(true);
    resetTelemetryPostureCache();
    expect(shouldTrack()).toBe(false);
  });

  it("re-enables after the user opts back in", () => {
    configState.telemetryEnabled = false;
    resetTelemetryPostureCache();
    trackEvent("render_complete", {});
    expect(enqueue).not.toHaveBeenCalled();

    configState.telemetryEnabled = true;
    resetTelemetryPostureCache();
    trackEvent("render_complete", {});
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
