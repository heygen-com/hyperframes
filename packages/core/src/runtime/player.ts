import type { RuntimePlayer, RuntimeSeekOptions, RuntimeTimelineLike } from "./types";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";
import { swallow } from "./diagnostics";

/**
 * Safely read a numeric value from a timeline property that may be either a
 * function (conformant GSAP) or a bare number (user-authored timeline-like).
 */
function safeNum(obj: unknown, prop: string, fallback: number): number {
  const val = (obj as Record<string, unknown>)?.[prop];
  if (typeof val === "function") return Number(val.call(obj)) || fallback;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (val !== undefined && val !== null) {
    swallow("runtime.player.nonConformantNum", { prop, actual: typeof val });
  }
  return fallback;
}

/**
 * Safely invoke a void method on a timeline. If the method is not a function
 * (missing or overwritten with a non-callable value), silently skip.
 */
function safeVoid(obj: unknown, method: string): void {
  const fn = (obj as Record<string, unknown>)?.[method];
  if (typeof fn === "function") {
    fn.call(obj);
    return;
  }
  if (fn !== undefined) {
    swallow("runtime.player.nonConformantVoid", { method, actual: typeof fn });
  }
}

export type RuntimePlayerTransport = Omit<RuntimePlayer, "_timeline">;

type PlayerDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
  setTimeline: (timeline: RuntimeTimelineLike | null) => void;
  getIsPlaying: () => boolean;
  setIsPlaying: (playing: boolean) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getCanonicalFps: () => number;
  onSyncMedia: (timeSeconds: number, playing: boolean) => void;
  onStatePost: (force: boolean) => void;
  onDeterministicSeek: (timeSeconds: number, options?: RuntimeSeekOptions) => void;
  onDeterministicPause: () => void;
  onDeterministicPlay: () => void;
  onRenderFrameSeek: (timeSeconds: number) => void;
  onShowNativeVideos: () => void;
  getSafeDuration?: () => number;
  /**
   * Optional registry of sibling timelines (typically `window.__timelines`).
   * Provided so that play/pause propagate to sub-scene timelines registered
   * alongside the master — e.g. a nested-composition master with per-scene
   * timelines like `scene1-logo-intro`, `scene2-4-canvas`. Without this,
   * pausing the master would leave scene timelines free-running and
   * animations would continue to advance visually past the paused time.
   */
  getTimelineRegistry?: () => Record<string, RuntimeTimelineLike | undefined>;
  /**
   * Optional transport implementation for runtimes with a dedicated clock.
   * The public player methods remain factory-owned and stable for the lifetime
   * of the runtime; callers must never replace them after construction.
   */
  transport?: RuntimePlayerTransport;
};

function forEachSiblingTimeline(
  registry: Record<string, RuntimeTimelineLike | undefined> | undefined | null,
  master: RuntimeTimelineLike,
  fn: (tl: RuntimeTimelineLike) => void,
): void {
  if (!registry) return;
  for (const tl of Object.values(registry)) {
    if (!tl || tl === master) continue;
    try {
      fn(tl);
    } catch (err) {
      // ignore sibling failures — one broken timeline shouldn't poison play/pause
      swallow("runtime.player.site1", err);
    }
  }
}

function seekTimelineDeterministically(
  timeline: RuntimeTimelineLike,
  timeSeconds: number,
  canonicalFps: number,
  options?: RuntimeSeekOptions,
): number {
  const quantized = quantizeTimeToFrame(timeSeconds, canonicalFps);
  const suppressEvents = options?.suppressEvents === true;
  safeVoid(timeline, "pause");
  if (typeof timeline.totalTime === "function") {
    timeline.totalTime(quantized, suppressEvents);
  } else {
    if (typeof timeline.seek === "function") timeline.seek(quantized, suppressEvents);
  }
  return quantized;
}

function seekMasterAndSiblingTimelinesDeterministically(
  registry: Record<string, RuntimeTimelineLike | undefined> | undefined | null,
  master: RuntimeTimelineLike,
  timeSeconds: number,
  canonicalFps: number,
  options?: RuntimeSeekOptions,
): number {
  const rearmedSiblings: RuntimeTimelineLike[] = [];
  forEachSiblingTimeline(registry, master, (tl) => {
    safeVoid(tl, "play");
    rearmedSiblings.push(tl);
  });
  try {
    return seekTimelineDeterministically(master, timeSeconds, canonicalFps, options);
  } finally {
    for (const tl of rearmedSiblings) {
      try {
        safeVoid(tl, "pause");
      } catch (err) {
        // ignore sibling failures — one broken timeline shouldn't poison seek
        swallow("runtime.player.site2", err);
      }
    }
  }
}

function activateSiblingTimelines(
  registry: Record<string, RuntimeTimelineLike | undefined> | undefined | null,
  master: RuntimeTimelineLike,
): void {
  forEachSiblingTimeline(registry, master, (tl) => {
    safeVoid(tl, "play");
  });
}

export function createRuntimePlayer(deps: PlayerDeps): RuntimePlayer {
  const transport = deps.transport;
  if (transport) {
    return {
      _timeline: null,
      play: () => transport.play(),
      pause: () => transport.pause(),
      seek: (timeSeconds, options) => transport.seek(timeSeconds, options),
      renderSeek: (timeSeconds, options) => transport.renderSeek(timeSeconds, options),
      getTime: () => transport.getTime(),
      getDuration: () => transport.getDuration(),
      isPlaying: () => transport.isPlaying(),
      setPlaybackRate: (rate) => transport.setPlaybackRate(rate),
      getPlaybackRate: () => transport.getPlaybackRate(),
    };
  }

  return {
    _timeline: null,
    play: () => {
      const timeline = deps.getTimeline();
      if (!timeline || deps.getIsPlaying()) return;
      const safeDuration = Math.max(
        0,
        Number(deps.getSafeDuration?.() ?? safeNum(timeline, "duration", 0)) || 0,
      );
      if (safeDuration > 0) {
        const currentTime = Math.max(0, safeNum(timeline, "time", 0));
        if (currentTime >= safeDuration) {
          safeVoid(timeline, "pause");
          if (typeof timeline.seek === "function") timeline.seek(0, false);
          deps.onDeterministicSeek(0);
          deps.setIsPlaying(false);
          deps.onSyncMedia(0, false);
          deps.onRenderFrameSeek(0);
        }
      }
      if (typeof timeline.timeScale === "function") {
        timeline.timeScale(deps.getPlaybackRate());
      }
      safeVoid(timeline, "play");
      forEachSiblingTimeline(deps.getTimelineRegistry?.(), timeline, (tl) => {
        if (typeof tl.timeScale === "function") tl.timeScale(deps.getPlaybackRate());
        safeVoid(tl, "play");
      });
      deps.onDeterministicPlay();
      deps.setIsPlaying(true);
      deps.onShowNativeVideos();
      deps.onStatePost(true);
    },
    pause: () => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      safeVoid(timeline, "pause");
      forEachSiblingTimeline(deps.getTimelineRegistry?.(), timeline, (tl) => {
        safeVoid(tl, "pause");
      });
      const time = Math.max(0, safeNum(timeline, "time", 0));
      deps.onDeterministicSeek(time);
      deps.onDeterministicPause();
      deps.setIsPlaying(false);
      deps.onSyncMedia(time, false);
      deps.onRenderFrameSeek(time);
      deps.onStatePost(true);
    },
    seek: (timeSeconds: number, options?: { keepPlaying?: boolean }) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      const safeTime = Math.max(0, Number(timeSeconds) || 0);
      const wasPlaying = deps.getIsPlaying();
      const quantized = seekMasterAndSiblingTimelinesDeterministically(
        deps.getTimelineRegistry?.(),
        timeline,
        safeTime,
        deps.getCanonicalFps(),
      );
      deps.onDeterministicSeek(quantized);
      if (options?.keepPlaying && wasPlaying) {
        // The deterministic seek helper pauses the master and rearmed siblings.
        // Resume them so the caller's playback state survives the seek.
        if (typeof timeline.timeScale === "function") {
          timeline.timeScale(deps.getPlaybackRate());
        }
        safeVoid(timeline, "play");
        forEachSiblingTimeline(deps.getTimelineRegistry?.(), timeline, (tl) => {
          if (typeof tl.timeScale === "function") tl.timeScale(deps.getPlaybackRate());
          safeVoid(tl, "play");
        });
        deps.onDeterministicPlay();
        deps.onShowNativeVideos();
        deps.onSyncMedia(quantized, true);
      } else {
        deps.setIsPlaying(false);
        deps.onSyncMedia(quantized, false);
      }
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    renderSeek: (timeSeconds: number, options?: RuntimeSeekOptions) => {
      const timeline = deps.getTimeline();
      const canonicalFps = deps.getCanonicalFps();
      // When a composition has no GSAP timeline (pure CSS / WAAPI / Lottie /
      // Three.js adapters driving the animation), still seek the adapters so
      // their animations advance. Without this, non-GSAP compositions freeze
      // on their initial frame.
      const quantized = timeline
        ? (() => {
            // Export seeks run frame-by-frame through the resolved root timeline.
            // If nested siblings stay paused, GSAP collapses the root back to the
            // authored master duration and later frames clamp incorrectly.
            activateSiblingTimelines(deps.getTimelineRegistry?.(), timeline);
            return seekTimelineDeterministically(timeline, timeSeconds, canonicalFps, options);
          })()
        : quantizeTimeToFrame(Math.max(0, Number(timeSeconds) || 0), canonicalFps);
      deps.onDeterministicSeek(quantized, options);
      deps.setIsPlaying(false);
      deps.onSyncMedia(quantized, false);
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    getTime: () => safeNum(deps.getTimeline(), "time", 0),
    getDuration: () => safeNum(deps.getTimeline(), "duration", 0),
    isPlaying: () => deps.getIsPlaying(),
    setPlaybackRate: (rate: number) => deps.setPlaybackRate(rate),
    getPlaybackRate: () => deps.getPlaybackRate(),
  };
}
