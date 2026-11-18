import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_FOR_ANOTHER_SITE_META } from "../studioPreviewMark";

const deps = () => ({
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onStopMedia: vi.fn(),
  onSeek: vi.fn(),
  onTick: vi.fn(),
  onSetMuted: vi.fn(),
  onSetVolume: vi.fn(),
  onSetMediaOutputMuted: vi.fn(),
  onSetNativeMediaSyncDisabled: vi.fn(),
  onSetWebAudioMediaDisabled: vi.fn(),
  onSetPlaybackRate: vi.fn(),
  onSetIdleHeartbeat: vi.fn(),
  onSetColorGrading: vi.fn(),
  onSetColorGradingCompare: vi.fn(),
  onSetRootDuration: vi.fn(),
  onSetPlayRange: vi.fn(),
  onEnablePickMode: vi.fn(),
  onDisablePickMode: vi.fn(),
  onSetRuntimeData: vi.fn(),
  onClearRuntimeData: vi.fn(),
  getCanonicalFps: vi.fn(() => 30),
});

const control = (action: string, extra?: Record<string, unknown>) =>
  new MessageEvent("message", {
    source: window.parent,
    data: { source: "hf-parent", type: "control", action, ...extra },
  });

// A fresh bridge module per test, so whether the page is marked is read from this test's document.
async function bridgeIn(marked: boolean) {
  vi.resetModules();
  if (marked) {
    const meta = document.createElement("meta");
    meta.name = PREVIEW_FOR_ANOTHER_SITE_META;
    document.head.prepend(meta);
  }
  const posted: { type: string }[] = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as { type: string });
  });
  const bridge = await import("./bridge");
  return { bridge, posted };
}

let handler: ((event: MessageEvent) => void) | null = null;

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = '<div id="secret" data-token="x">Unpublished line</div>';
});

afterEach(() => {
  if (handler) window.removeEventListener("message", handler);
  handler = null;
  vi.restoreAllMocks();
  document.getElementById("__hf-flash-styles")?.remove();
});

describe("runtime bridge in a page marked for another site", () => {
  it("takes playback controls but no inspection or document-changing ones", async () => {
    const { bridge } = await bridgeIn(true);
    const calls = deps();
    handler = bridge.installRuntimeControlBridge(calls);

    for (const action of ["play", "pause", "seek", "set-muted", "set-volume"])
      handler(control(action, { timeSeconds: 1, volume: 0.5 }));
    handler(control("enable-pick-mode"));
    handler(control("flash-elements", { selectors: ["#secret"], duration: 500 }));
    handler(control("set-runtime-data", { channel: "x", payload: 1 }));
    handler(control("clear-runtime-data", { channel: "x" }));
    handler(control("set-color-grading", { target: null, grading: {} }));
    handler(control("set-play-range", { startSeconds: 0, endSeconds: 1 }));

    expect(calls.onPlay).toHaveBeenCalledOnce();
    expect(calls.onPause).toHaveBeenCalledOnce();
    expect(calls.onSeek).toHaveBeenCalledWith(1, "commit");
    expect(calls.onSetVolume).toHaveBeenCalledWith(0.5);
    expect(calls.onEnablePickMode).not.toHaveBeenCalled();
    expect(calls.onSetRuntimeData).not.toHaveBeenCalled();
    expect(calls.onClearRuntimeData).not.toHaveBeenCalled();
    expect(calls.onSetColorGrading).not.toHaveBeenCalled();
    expect(calls.onSetPlayRange).not.toHaveBeenCalled();
    expect(document.getElementById("__hf-flash-styles")).toBeNull();
    expect(document.getElementById("secret")?.classList.contains("__hf-flash")).toBe(false);
  });

  it("sends that site only bare playback state", async () => {
    const { bridge, posted } = await bridgeIn(true);
    handler = bridge.installRuntimeControlBridge(deps());
    for (const type of ["timeline", "diagnostic", "element-hovered", "element-picked", "analytics"])
      bridge.postRuntimeMessage({ source: "hf-preview", type } as never);
    bridge.postRuntimeMessage({
      source: "hf-preview",
      type: "state",
      frame: 0,
      currentTime: 0,
      ended: false,
      isPlaying: false,
      buffering: false,
      muted: false,
      playbackRate: 1,
    });

    expect(posted.map((message) => message.type)).toEqual(["ready", "state"]);
  });

  it("still serves every control and message to a page served to its own site", async () => {
    const { bridge, posted } = await bridgeIn(false);
    const calls = deps();
    handler = bridge.installRuntimeControlBridge(calls);
    handler(control("enable-pick-mode"));
    handler(control("set-runtime-data", { channel: "x", payload: 1 }));
    bridge.postRuntimeMessage({ source: "hf-preview", type: "timeline" } as never);

    expect(calls.onEnablePickMode).toHaveBeenCalledOnce();
    expect(calls.onSetRuntimeData).toHaveBeenCalledOnce();
    expect(posted.map((message) => message.type)).toEqual(["ready", "timeline"]);
  });
});
