import { describe, it, expect, vi, beforeEach } from "vitest";
import { initRuntimeAnalytics, emitAnalyticsEvent, emitPerformanceMetric } from "./analytics";

describe("runtime analytics", () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    // Reset module state by re-init
    initRuntimeAnalytics(postMessage);
  });

  it("emits analytics event via postMessage", () => {
    emitAnalyticsEvent("composition_loaded");
    expect(postMessage).toHaveBeenCalledWith({
      source: "hf-preview",
      type: "analytics",
      event: "composition_loaded",
      properties: {},
    });
  });

  it("passes properties through", () => {
    emitAnalyticsEvent("composition_played", { duration: 10, autoplay: true });
    expect(postMessage).toHaveBeenCalledWith({
      source: "hf-preview",
      type: "analytics",
      event: "composition_played",
      properties: { duration: 10, autoplay: true },
    });
  });

  it("does not throw when postMessage is not set", () => {
    // Re-init with a function that we'll clear
    initRuntimeAnalytics(null as unknown as (payload: unknown) => void);
    expect(() => emitAnalyticsEvent("composition_paused")).not.toThrow();
  });

  it("does not throw when postMessage throws", () => {
    postMessage.mockImplementation(() => {
      throw new Error("channel closed");
    });
    expect(() => emitAnalyticsEvent("composition_seeked")).not.toThrow();
  });

  it("emits all event types", () => {
    const events = [
      "composition_loaded",
      "composition_played",
      "composition_paused",
      "composition_seeked",
      "composition_ended",
      "element_picked",
    ] as const;
    for (const event of events) {
      emitAnalyticsEvent(event);
    }
    expect(postMessage).toHaveBeenCalledTimes(events.length);
  });
});

describe("runtime performance metrics", () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    initRuntimeAnalytics(postMessage);
    // Clean up DevTools marks between tests to avoid cross-test interference.
    if (typeof performance !== "undefined" && typeof performance.clearMarks === "function") {
      performance.clearMarks();
    }
  });

  it("emits a perf metric via postMessage", () => {
    emitPerformanceMetric("player_scrub_latency", 12.5);
    expect(postMessage).toHaveBeenCalledWith({
      source: "hf-preview",
      type: "perf",
      name: "player_scrub_latency",
      value: 12.5,
      tags: {},
    });
  });

  it("passes tags through", () => {
    emitPerformanceMetric("player_decoder_count", 3, {
      composition_id: "abc123",
      mode: "isolated",
    });
    expect(postMessage).toHaveBeenCalledWith({
      source: "hf-preview",
      type: "perf",
      name: "player_decoder_count",
      value: 3,
      tags: { composition_id: "abc123", mode: "isolated" },
    });
  });

  it("normalizes missing tags to an empty object", () => {
    emitPerformanceMetric("player_playback_fps", 60);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ tags: {} }));
  });

  it("supports zero and negative values", () => {
    emitPerformanceMetric("player_dropped_frames", 0);
    emitPerformanceMetric("player_media_sync_drift", -8.3);
    expect(postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ value: 0 }));
    expect(postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: -8.3 }));
  });

  it("does not throw when postMessage is not set", () => {
    initRuntimeAnalytics(null as unknown as (payload: unknown) => void);
    expect(() => emitPerformanceMetric("player_load_time", 250)).not.toThrow();
  });

  it("does not throw when postMessage throws", () => {
    postMessage.mockImplementation(() => {
      throw new Error("channel closed");
    });
    expect(() => emitPerformanceMetric("player_scrub_latency", 12)).not.toThrow();
  });

  it("does not throw when performance.mark throws", () => {
    const original = performance.mark;
    // Vitest provides a real performance API; replace mark with a thrower for this test.
    performance.mark = vi.fn(() => {
      throw new Error("mark failed");
    }) as typeof performance.mark;
    try {
      expect(() => emitPerformanceMetric("player_load_time", 100)).not.toThrow();
      // Even though performance.mark threw, the bridge should still receive the metric.
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "perf", name: "player_load_time", value: 100 }),
      );
    } finally {
      performance.mark = original;
    }
  });

  it("writes a User Timing mark with detail for DevTools visibility", () => {
    if (typeof performance.getEntriesByName !== "function") {
      // Older test environments — skip the DevTools assertion but don't fail.
      return;
    }
    emitPerformanceMetric("player_composition_switch", 42, { from: "a", to: "b" });
    const entries = performance.getEntriesByName("player_composition_switch", "mark");
    expect(entries.length).toBeGreaterThan(0);
    const mark = entries[entries.length - 1] as PerformanceMark;
    expect(mark.detail).toEqual({ value: 42, tags: { from: "a", to: "b" } });
  });
});
