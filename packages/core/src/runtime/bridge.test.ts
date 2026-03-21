import { describe, it, expect, vi, beforeEach } from "vitest";
import { installRuntimeControlBridge } from "./bridge";

function createMockDeps() {
  return {
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSeek: vi.fn(),
    onSetMuted: vi.fn(),
    onSetPlaybackRate: vi.fn(),
    onEnablePickMode: vi.fn(),
    onDisablePickMode: vi.fn(),
  };
}

function makeControlMessage(action: string, extra?: Record<string, unknown>) {
  return new MessageEvent("message", {
    data: { source: "hf-parent", type: "control", action, ...extra },
  });
}

describe("installRuntimeControlBridge", () => {
  it("dispatches play command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("play"));
    expect(deps.onPlay).toHaveBeenCalledOnce();
  });

  it("dispatches pause command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("pause"));
    expect(deps.onPause).toHaveBeenCalledOnce();
  });

  it("dispatches seek command with frame and mode", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("seek", { frame: 150, seekMode: "drag" }));
    expect(deps.onSeek).toHaveBeenCalledWith(150, "drag");
  });

  it("seek defaults frame to 0 and seekMode to commit", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("seek"));
    expect(deps.onSeek).toHaveBeenCalledWith(0, "commit");
  });

  it("dispatches set-muted command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-muted", { muted: true }));
    expect(deps.onSetMuted).toHaveBeenCalledWith(true);
  });

  it("dispatches set-playback-rate command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-playback-rate", { playbackRate: 2 }));
    expect(deps.onSetPlaybackRate).toHaveBeenCalledWith(2);
  });

  it("defaults playbackRate to 1", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-playback-rate"));
    expect(deps.onSetPlaybackRate).toHaveBeenCalledWith(1);
  });

  it("dispatches enable-pick-mode", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("enable-pick-mode"));
    expect(deps.onEnablePickMode).toHaveBeenCalledOnce();
  });

  it("dispatches disable-pick-mode", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("disable-pick-mode"));
    expect(deps.onDisablePickMode).toHaveBeenCalledOnce();
  });

  it("ignores messages from wrong source", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(new MessageEvent("message", {
      data: { source: "other", type: "control", action: "play" },
    }));
    expect(deps.onPlay).not.toHaveBeenCalled();
  });

  it("ignores messages with wrong type", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(new MessageEvent("message", {
      data: { source: "hf-parent", type: "state", action: "play" },
    }));
    expect(deps.onPlay).not.toHaveBeenCalled();
  });

  it("ignores null data", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(new MessageEvent("message", { data: null }));
    expect(deps.onPlay).not.toHaveBeenCalled();
  });

  it("handles flash-elements command without crashing", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    expect(() =>
      handler(makeControlMessage("flash-elements", { selectors: [".test"], duration: 500 }))
    ).not.toThrow();
  });
});
