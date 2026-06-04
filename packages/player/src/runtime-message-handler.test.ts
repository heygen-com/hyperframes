import { describe, expect, it, vi } from "vitest";

import { handleRuntimeMessage, type MessageHandlerCallbacks } from "./runtime-message-handler.js";
import type { ParentMediaManager } from "./parent-media.js";
import type { ShaderLoaderState } from "./shader-loader-state.js";

// Only the stage-size branch is exercised here; the rest of the callback
// surface is satisfied with inert spies so the handler's type contract
// stays honest without pulling in the real player.
const makeCallbacks = (): MessageHandlerCallbacks => ({
  updateControlsTime: vi.fn(),
  updateControlsPlaying: vi.fn(),
  dispatchEvent: vi.fn(),
  seek: vi.fn(),
  play: vi.fn(),
  getLoop: vi.fn(() => false),
  media: { mirrorTime: vi.fn(), promoteToParentProxy: vi.fn() } as unknown as ParentMediaManager,
  getPlaybackState: vi.fn(() => ({ currentTime: 0, duration: 0, paused: true, lastUpdateMs: 0 })),
  setPlaybackState: vi.fn(),
  getShaderLoadingMode: vi.fn(() => "auto"),
  shaderLoader: { update: vi.fn() } as unknown as ShaderLoaderState,
  setCompositionSize: vi.fn(),
  sendControl: vi.fn(),
  getIframeDoc: vi.fn(() => null),
});

const stageSizeEvent = (width: unknown, height: unknown, source: object): MessageEvent =>
  ({
    source,
    data: { source: "hf-preview", type: "stage-size", width, height },
  }) as unknown as MessageEvent;

describe("handleRuntimeMessage stage-size", () => {
  it("applies a finite positive stage size", () => {
    const frameWindow = {} as Window;
    const callbacks = makeCallbacks();

    handleRuntimeMessage(stageSizeEvent(1280, 720, frameWindow), frameWindow, callbacks);

    expect(callbacks.setCompositionSize).toHaveBeenCalledWith(1280, 720);
  });

  it.each([
    ["Infinity width", Infinity, 720],
    ["Infinity height", 1280, Infinity],
    ["NaN width", NaN, 720],
    ["zero width", 0, 720],
    ["negative height", 1280, -720],
    ["string width", "1280", 720],
  ])("ignores stage-size with %s", (_label, width, height) => {
    const frameWindow = {} as Window;
    const callbacks = makeCallbacks();

    handleRuntimeMessage(stageSizeEvent(width, height, frameWindow), frameWindow, callbacks);

    expect(callbacks.setCompositionSize).not.toHaveBeenCalled();
  });

  it("ignores messages from a different source window", () => {
    const frameWindow = {} as Window;
    const callbacks = makeCallbacks();

    handleRuntimeMessage(stageSizeEvent(1280, 720, {}), frameWindow, callbacks);

    expect(callbacks.setCompositionSize).not.toHaveBeenCalled();
  });
});
