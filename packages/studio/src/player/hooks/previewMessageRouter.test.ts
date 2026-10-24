import { describe, expect, it, vi } from "vitest";
import { createPreviewMessageHandler } from "./previewMessageRouter";

function route(isPlaying: boolean) {
  const enrich = vi.fn();
  const handle = createPreviewMessageHandler({
    iframeRef: { current: null },
    processTimelineMessageRef: { current: vi.fn() },
    enrichMissingCompositionsRef: { current: enrich },
    lastTimelineMessageRef: { current: 0 },
    getAdapter: () => null,
    syncTimelineElements: vi.fn(),
  });
  handle(new MessageEvent("message", { data: { source: "hf-preview", type: "state", isPlaying } }));
  return enrich;
}

describe("preview state messages", () => {
  it("re-reads the preview for missing compositions only while it is stopped", () => {
    expect(route(true)).not.toHaveBeenCalled();
    expect(route(false)).toHaveBeenCalledTimes(1);
  });
});
