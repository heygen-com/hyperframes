// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { makeFakeIframe, serveEditingRequests } from "./timelinePlayerTestHarness";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  usePlayerStore.getState().reset();
});

describe("a state tick while the timeline is empty", () => {
  it("asks the runtime for its manifest over the editing port, one request at a time", async () => {
    const manifest = { clips: [{ id: "a" }], durationInFrames: 60, scenes: [] };
    // The frame's globals carry a different manifest: only the port's answer may be used.
    const frame: Record<string, unknown> = { __clipManifest: { clips: [{ id: "x" }] } };
    const iframe = makeFakeIframe(frame);
    const asked = vi.fn(() => ({ clipManifest: manifest }));
    closers.push(serveEditingRequests(frame, asked));
    const processed = vi.fn();
    const handle = createPreviewMessageHandler({
      iframeRef: { current: iframe },
      processTimelineMessageRef: { current: processed },
      enrichMissingCompositionsRef: { current: vi.fn() },
      lastTimelineMessageRef: { current: Date.now() },
      getAdapter: () => null,
      syncTimelineElements: vi.fn(),
    });
    const tick = () =>
      handle(
        new MessageEvent("message", {
          source: frame as unknown as Window,
          data: { source: "hf-preview", type: "state", isPlaying: false },
        }),
      );

    tick();
    tick();
    await vi.waitFor(() => expect(processed).toHaveBeenCalledWith(manifest));
    expect(asked).toHaveBeenCalledOnce();
    expect(processed).toHaveBeenCalledOnce();
  });
});
