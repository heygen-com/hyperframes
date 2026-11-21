// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { detachedFakeIframe, serveEditingRequests } from "./timelinePlayerTestHarness";

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  usePlayerStore.getState().reset();
});

const PORT_MANIFEST = { clips: [{ id: "a" }], durationInFrames: 60, scenes: [] };
const GLOBAL_MANIFEST = { clips: [{ id: "x" }], durationInFrames: 30, scenes: [] };

/** A frame whose globals and editing port carry different manifests, so a test sees which was read. */
function routeStateTicks(opaque: boolean) {
  const frame: Record<string, unknown> = { __clipManifest: GLOBAL_MANIFEST };
  const iframe = detachedFakeIframe(frame);
  if (opaque) {
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(frame, "document", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  }
  const asked = vi.fn(() => ({ clipManifest: PORT_MANIFEST }));
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
        origin: window.location.origin,
        data: { source: "hf-preview", type: "state", isPlaying: false },
      }),
    );
  return { tick, asked, processed };
}

describe("a state tick while the timeline is empty", () => {
  it("reads a scriptable frame's manifest straight off it, at once, with no port", async () => {
    const { tick, asked, processed } = routeStateTicks(false);
    tick();
    expect(processed).toHaveBeenCalledWith(GLOBAL_MANIFEST);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).not.toHaveBeenCalled();
  });

  it("asks an opaque frame's runtime over the editing port, one request at a time", async () => {
    const { tick, asked, processed } = routeStateTicks(true);
    tick();
    tick();
    await vi.waitFor(() => expect(processed).toHaveBeenCalledWith(PORT_MANIFEST));
    expect(asked).toHaveBeenCalledOnce();
    expect(processed).toHaveBeenCalledOnce();
  });
});

it("asks a live opaque frame it has not heard from once, though its film has no clips", async () => {
  usePlayerStore
    .getState()
    .setElements([{ id: "a", domId: "a", tag: "p", start: 0, duration: 2, track: 0 }]);
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const asked = vi.fn(() => ({ clipManifest: { clips: [], durationInFrames: 60, scenes: [] } }));
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
        origin: window.location.origin,
        data: { source: "hf-preview", type: "state", isPlaying: false },
      }),
    );
  tick();
  await vi.waitFor(() => expect(asked).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 20));
  tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(asked).toHaveBeenCalledOnce();
  expect(processed).not.toHaveBeenCalled();
});
