import { describe, it, expect, vi } from "vitest";
import { installRuntimeControlBridge } from "./bridge";

function createMockDeps() {
  return {
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
    onSetColorGrading: vi.fn(),
    onSetColorGradingCompare: vi.fn(),
    onSetRootDuration: vi.fn(),
    onEnablePickMode: vi.fn(),
    onDisablePickMode: vi.fn(),
    getCanonicalFps: vi.fn(() => 30),
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

  it("dispatches stop-media command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("stop-media"));
    expect(deps.onStopMedia).toHaveBeenCalledOnce();
  });

  it("dispatches seek command with frame and mode", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("seek", { frame: 150, seekMode: "drag" }));
    expect(deps.onSeek).toHaveBeenCalledWith(5, "drag");
  });

  it("prefers canonical seconds in protocol v1 seek messages", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(
      makeControlMessage("seek", {
        protocolVersion: 1,
        capabilities: ["seconds-time", "rational-fps", "seek-keep-playing"],
        fps: { numerator: 60, denominator: 1 },
        timeSeconds: 2.5,
        frame: 999,
      }),
    );
    expect(deps.onSeek).toHaveBeenCalledWith(2.5, "commit");
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

  it("dispatches set-volume command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-volume", { volume: 0.5 }));
    expect(deps.onSetVolume).toHaveBeenCalledWith(0.5);
  });

  it("clamps set-volume to [0, 1]", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-volume", { volume: 1.5 }));
    expect(deps.onSetVolume).toHaveBeenCalledWith(1);
    handler(makeControlMessage("set-volume", { volume: -0.5 }));
    expect(deps.onSetVolume).toHaveBeenCalledWith(0);
  });

  it("defaults volume to 1 when absent", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-volume"));
    expect(deps.onSetVolume).toHaveBeenCalledWith(1);
  });

  it("dispatches set-media-output-muted command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-media-output-muted", { muted: true }));
    expect(deps.onSetMediaOutputMuted).toHaveBeenCalledWith(true);
    handler(makeControlMessage("set-media-output-muted", { muted: false }));
    expect(deps.onSetMediaOutputMuted).toHaveBeenCalledWith(false);
  });

  it("set-media-output-muted coerces absent flag to false", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-media-output-muted"));
    expect(deps.onSetMediaOutputMuted).toHaveBeenCalledWith(false);
  });

  it("dispatches set-native-media-sync-disabled command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-native-media-sync-disabled", { disabled: true }));
    expect(deps.onSetNativeMediaSyncDisabled).toHaveBeenCalledWith(true);
    handler(makeControlMessage("set-native-media-sync-disabled", { disabled: false }));
    expect(deps.onSetNativeMediaSyncDisabled).toHaveBeenCalledWith(false);
  });

  it("set-native-media-sync-disabled coerces absent flag to false", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-native-media-sync-disabled"));
    expect(deps.onSetNativeMediaSyncDisabled).toHaveBeenCalledWith(false);
  });

  it("dispatches set-web-audio-media-disabled command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-web-audio-media-disabled", { disabled: true }));
    expect(deps.onSetWebAudioMediaDisabled).toHaveBeenCalledWith(true);
    handler(makeControlMessage("set-web-audio-media-disabled", { disabled: false }));
    expect(deps.onSetWebAudioMediaDisabled).toHaveBeenCalledWith(false);
  });

  it("set-web-audio-media-disabled coerces absent flag to false", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-web-audio-media-disabled"));
    expect(deps.onSetWebAudioMediaDisabled).toHaveBeenCalledWith(false);
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

  it("dispatches set-root-duration command with numeric seconds", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("set-root-duration", { durationSeconds: "18.5" }));
    expect(deps.onSetRootDuration).toHaveBeenCalledWith(18.5);
  });

  it("dispatches set-color-grading command with target and grading payload", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    const grading = { preset: "warm-clean", intensity: 0.7 };
    const target = { id: "hero-video", selectorIndex: 0 };
    handler(makeControlMessage("set-color-grading", { target, grading }));
    expect(deps.onSetColorGrading).toHaveBeenCalledWith(target, grading);
  });

  it("dispatches set-color-grading-compare command with target and compare payload", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    const compare = { enabled: true, position: 0.42 };
    const target = { id: "hero-video", selectorIndex: 0 };
    handler(makeControlMessage("set-color-grading-compare", { target, compare }));
    expect(deps.onSetColorGradingCompare).toHaveBeenCalledWith(target, compare);
  });

  it("dispatches tick command", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("tick"));
    expect(deps.onTick).toHaveBeenCalledOnce();
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
    handler(
      new MessageEvent("message", {
        data: { source: "other", type: "control", action: "play" },
      }),
    );
    expect(deps.onPlay).not.toHaveBeenCalled();
  });

  it("ignores messages with wrong type", () => {
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(
      new MessageEvent("message", {
        data: { source: "hf-parent", type: "state", action: "play" },
      }),
    );
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
      handler(makeControlMessage("flash-elements", { selectors: [".test"], duration: 500 })),
    ).not.toThrow();
  });

  it("posts a ready message to window.parent on install", () => {
    // The bridge announces itself so the parent can replay any control
    // messages it posted before the iframe runtime's listener was installed.
    const postSpy = vi.spyOn(window.parent, "postMessage");
    const deps = createMockDeps();
    installRuntimeControlBridge(deps);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hf-preview",
        type: "ready",
        protocolVersion: 1,
        fps: { numerator: 30, denominator: 1 },
      }),
      "*",
    );
    postSpy.mockRestore();
  });

  it("rejects an unknown protocol major with a diagnostic", () => {
    const postSpy = vi.spyOn(window.parent, "postMessage");
    const deps = createMockDeps();
    const handler = installRuntimeControlBridge(deps);
    handler(makeControlMessage("play", { protocolVersion: 2 }));

    expect(deps.onPlay).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "diagnostic",
        code: "runtime.protocol.unsupported_protocol_version",
      }),
      "*",
    );
    postSpy.mockRestore();
  });
});
