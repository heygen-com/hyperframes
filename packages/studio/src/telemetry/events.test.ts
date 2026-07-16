import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock client.trackEvent so we can assert event names and payloads without
// firing network requests or relying on memoized shouldTrack() state.
const trackEvent = vi.fn();
vi.mock("./client", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const {
  trackStudioSessionStart,
  trackStudioRenderStart,
  trackStudioRazorSplit,
  trackStudioExpandedClipEdit,
  trackStudioFeedback,
} = await import("./events");

describe("studio telemetry events", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("trackStudioSessionStart emits 'studio_session_start' with has_project", () => {
    trackStudioSessionStart({ has_project: true });
    expect(trackEvent).toHaveBeenCalledOnce();
    expect(trackEvent).toHaveBeenCalledWith("studio_session_start", { has_project: true });
  });

  it("trackStudioSessionStart preserves false for has_project (scratch open)", () => {
    trackStudioSessionStart({ has_project: false });
    expect(trackEvent).toHaveBeenCalledWith("studio_session_start", { has_project: false });
  });

  it("trackStudioRenderStart emits 'studio_render_start' with all render opts", () => {
    trackStudioRenderStart({
      fps: 30,
      quality: "standard",
      format: "mp4",
      resolution: "landscape",
      composition: "intro.html",
    });
    expect(trackEvent).toHaveBeenCalledOnce();
    expect(trackEvent).toHaveBeenCalledWith("studio_render_start", {
      fps: 30,
      quality: "standard",
      format: "mp4",
      resolution: "landscape",
      composition: "intro.html",
    });
  });

  it("trackStudioRenderStart leaves optional fields undefined when omitted", () => {
    trackStudioRenderStart({ fps: 60, quality: "high", format: "webm" });
    const payload = trackEvent.mock.calls[0][1];
    expect(payload).toEqual({
      fps: 60,
      quality: "high",
      format: "webm",
      resolution: undefined,
      composition: undefined,
    });
  });

  it("trackStudioRazorSplit emits 'studio_razor_split' with mode and count", () => {
    trackStudioRazorSplit({ mode: "all", count: 3 });
    expect(trackEvent).toHaveBeenCalledWith("studio_razor_split", { mode: "all", count: 3 });
  });

  it("trackStudioExpandedClipEdit emits 'studio_expanded_clip_edit' with action", () => {
    trackStudioExpandedClipEdit({ action: "resize" });
    expect(trackEvent).toHaveBeenCalledWith("studio_expanded_clip_edit", { action: "resize" });
  });

  it.each([0, 10])("trackStudioFeedback preserves NPS boundary %i and its scale", (rating) => {
    trackStudioFeedback({ rating });

    expect(trackEvent).toHaveBeenCalledWith(
      "survey sent",
      expect.objectContaining({ $survey_response: rating, rating_scale: 10 }),
    );
  });
});
