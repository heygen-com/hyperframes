import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "./types";
import type { RuntimeMediaClip } from "./media";
import type { TransportClock } from "./clock";

export type RuntimeState = {
  capturedTimeline: RuntimeTimelineLike | null;
  isPlaying: boolean;
  rafId: number | null;
  currentTime: number;
  deterministicAdapters: RuntimeDeterministicAdapter[];
  parityModeEnabled: boolean;
  canonicalFps: number;
  bridgeMuted: boolean;
  bridgeVolume: number;
  /**
   * Internal mute of audible media output, owned by the audio-ownership
   * protocol between the parent (`<hyperframes-player>`) and this runtime.
   * Independent of `bridgeMuted` (the user's mute preference). When the
   * parent takes over audible playback via parent-frame proxies, it sets
   * this to `true` so the runtime keeps driving timed media for frame
   * accuracy but produces no audio of its own.
   */
  mediaOutputMuted: boolean;
  /**
   * Latch so the `media-autoplay-blocked` outbound message is posted at most
   * once per runtime session. The parent only needs the first signal — it
   * takes over playback and further rejections are the same problem.
   */
  mediaAutoplayBlockedPosted: boolean;
  /**
   * One-shot flag: force a hard media sync on the next tick. Set on
   * play/pause/seek/rate transitions to immediately correct any
   * accumulated sub-threshold drift from pause/play toggling.
   * Consumed (reset to false) by `syncMediaForCurrentState`.
   */
  mediaForceSyncNextTick: boolean;
  playbackRate: number;
  bridgeLastPostedFrame: number;
  bridgeLastPostedAt: number;
  bridgeLastPostedPlaying: boolean;
  bridgeLastPostedMuted: boolean;
  /**
   * Max interval (ms) between outbound timeline samples on the parent-frame
   * control bridge. The bridge posts on every changed frame, but also at
   * least once per this interval so a paused/idle timeline still confirms
   * its position to any listener.
   *
   * **Cross-reference (do not change in isolation)**: the parent-frame
   * audio-mirror loop in `<hyperframes-player>` waits for
   * `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES` consecutive over-threshold
   * samples before issuing a `currentTime` correction. The product of
   * those two constants is the worst-case A/V re-sync latency:
   *
   *   worst_case_correction_latency_ms
   *     ≈ MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES × bridgeMaxPostIntervalMs
   *
   * Today: `2 × 80 ms = 160 ms`, which sits comfortably under the
   * perceptual A/V re-sync tolerance. If you raise this interval, audit
   * `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES` in
   * `packages/player/src/hyperframes-player.ts` — leaving it at `2` will
   * silently push correction latency past the tolerance budget.
   */
  bridgeMaxPostIntervalMs: number;
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
  /**
   * Single-clock transport. The sole time authority — GSAP is always
   * paused and seeked to `clock.now()` on each rAF tick. Eliminates
   * the two-clock drift problem described in issue #668.
   */
  transportClock: TransportClock | null;
  /** rAF ID for the single-clock tick loop. */
  transportRafId: number | null;
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
    bridgeVolume: 1,
    mediaOutputMuted: false,
    mediaAutoplayBlockedPosted: false,
    mediaForceSyncNextTick: false,
    playbackRate: 1,
    bridgeLastPostedFrame: -1,
    bridgeLastPostedAt: 0,
    bridgeLastPostedPlaying: false,
    bridgeLastPostedMuted: false,
    bridgeMaxPostIntervalMs: 80,
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
    transportClock: null,
    transportRafId: null,
  };
}
