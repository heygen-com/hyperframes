import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "./types";
import type { RuntimeMediaClip } from "./media";

export type RuntimeState = {
  capturedTimeline: RuntimeTimelineLike | null;
  isPlaying: boolean;
  rafId: number | null;
  currentTime: number;
  deterministicAdapters: RuntimeDeterministicAdapter[];
  parityModeEnabled: boolean;
  canonicalFps: number;
  bridgeMuted: boolean;
  playbackRate: number;
  bridgeLastPostedFrame: number;
  bridgeLastPostedAt: number;
  bridgeLastPostedPlaying: boolean;
  bridgeLastPostedMuted: boolean;
  bridgeMaxPostIntervalMs: number;
  timelinePollIntervalId: ReturnType<typeof setInterval> | null;
  controlBridgeHandler: ((event: MessageEvent) => void) | null;
  clampDurationLoggedRaw: number | null;
  beforeUnloadHandler: (() => void) | null;
  domReadyHandler: (() => void) | null;
  injectedCompStyles: HTMLStyleElement[];
  injectedCompScripts: HTMLScriptElement[];
  cachedTimedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  cachedMediaClips: RuntimeMediaClip[];
  cachedVideoClips: RuntimeMediaClip[];
  cachedMediaTimelineDurationSeconds: number;
  tornDown: boolean;
  maxTimelineDurationSeconds: number;
  nativeVisualWatchdogTick: number;
};

export function createRuntimeState(): RuntimeState {
  return {
    capturedTimeline: null,
    isPlaying: false,
    rafId: null,
    currentTime: 0,
    deterministicAdapters: [],
    parityModeEnabled: true,
    canonicalFps: 30,
    bridgeMuted: false,
    playbackRate: 1,
    bridgeLastPostedFrame: -1,
    bridgeLastPostedAt: 0,
    bridgeLastPostedPlaying: false,
    bridgeLastPostedMuted: false,
    bridgeMaxPostIntervalMs: 80,
    timelinePollIntervalId: null,
    controlBridgeHandler: null,
    clampDurationLoggedRaw: null,
    beforeUnloadHandler: null,
    domReadyHandler: null,
    injectedCompStyles: [],
    injectedCompScripts: [],
    cachedTimedMediaEls: [],
    cachedMediaClips: [],
    cachedVideoClips: [],
    cachedMediaTimelineDurationSeconds: 0,
    tornDown: false,
    maxTimelineDurationSeconds: 1800,
    nativeVisualWatchdogTick: 0,
  };
}
