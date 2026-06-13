import { describe, it, expect, vi, beforeEach } from "vitest";
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";

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
