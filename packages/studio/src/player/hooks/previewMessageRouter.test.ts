import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.fn();
vi.mock("../../telemetry/client", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const { createPreviewMessageHandler } = await import("./previewMessageRouter");

const previewWindow = {};
const handle = createPreviewMessageHandler({
  iframeRef: { current: { contentWindow: previewWindow } as unknown as HTMLIFrameElement },
  processTimelineMessageRef: { current: () => {} },
  enrichMissingCompositionsRef: { current: () => {} },
  lastTimelineMessageRef: { current: 0 },
  getAdapter: () => null,
  syncTimelineElements: () => {},
});

function analytics(event: string, properties: Record<string, unknown>, source = previewWindow) {
  handle({
    source,
    data: { source: "hf-preview", type: "analytics", event, properties },
  } as unknown as MessageEvent);
}

const resync = { drift: 1.2, codec: "hevc", rate: 1.15, copy: false, reason: "hard" };

describe("preview message router analytics forwarding", () => {
  beforeEach(() => trackEvent.mockClear());

  it("forwards media_resynced from the preview to the telemetry client", () => {
    analytics("media_resynced", resync);
    expect(trackEvent).toHaveBeenCalledOnce();
    expect(trackEvent).toHaveBeenCalledWith("media_resynced", resync);
  });

  it("drops a codec that is not a plain codec name", () => {
    analytics("media_resynced", { ...resync, codec: "/Users/me/clip.mov" });
    expect(trackEvent).toHaveBeenCalledWith("media_resynced", { ...resync, codec: undefined });
  });

  it("forwards no other runtime analytics event, and nothing from another frame", () => {
    analytics("composition_played", { time: 1 });
    analytics("media_resynced", resync, {});
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
