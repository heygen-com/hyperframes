import type { RuntimePlayer, RuntimeTimelineLike } from "./types";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";

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
  onDeterministicSeek: (timeSeconds: number) => void;
  onDeterministicPause: () => void;
  onDeterministicPlay: () => void;
  onRenderFrameSeek: (timeSeconds: number) => void;
  onShowNativeVideos: () => void;
  getSafeDuration?: () => number;
};

function seekTimelineDeterministically(
  timeline: RuntimeTimelineLike,
  timeSeconds: number,
  canonicalFps: number,
): number {
  const quantized = quantizeTimeToFrame(timeSeconds, canonicalFps);
  timeline.pause();
  if (typeof timeline.totalTime === "function") {
    timeline.totalTime(quantized, false);
  } else {
    timeline.seek(quantized, false);
  }
  return quantized;
}

export function createRuntimePlayer(deps: PlayerDeps): RuntimePlayer {
  return {
    _timeline: null,
    play: () => {
      const timeline = deps.getTimeline();
      if (!timeline || deps.getIsPlaying()) return;
      const safeDuration = Math.max(0, Number(deps.getSafeDuration?.() ?? timeline.duration() ?? 0) || 0);
      if (safeDuration > 0) {
        const currentTime = Math.max(0, Number(timeline.time()) || 0);
        if (currentTime >= safeDuration) {
          timeline.pause();
          timeline.seek(0, false);
          deps.onDeterministicSeek(0);
          deps.setIsPlaying(false);
          deps.onSyncMedia(0, false);
          deps.onRenderFrameSeek(0);
        }
      }
      if (typeof timeline.timeScale === "function") {
        timeline.timeScale(deps.getPlaybackRate());
      }
      timeline.play();
      deps.onDeterministicPlay();
      deps.setIsPlaying(true);
      deps.onShowNativeVideos();
      deps.onStatePost(true);
    },
    pause: () => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
      const time = Math.max(0, Number(timeline.time()) || 0);
      deps.onDeterministicSeek(time);
      deps.onDeterministicPause();
      deps.setIsPlaying(false);
      deps.onSyncMedia(time, false);
      deps.onRenderFrameSeek(time);
      deps.onStatePost(true);
    },
    seek: (timeSeconds: number) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      const safeTime = Math.max(0, Number(timeSeconds) || 0);
      const quantized = seekTimelineDeterministically(timeline, safeTime, deps.getCanonicalFps());
      deps.onDeterministicSeek(quantized);
      deps.setIsPlaying(false);
      deps.onSyncMedia(quantized, false);
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    renderSeek: (timeSeconds: number) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      const quantized = seekTimelineDeterministically(timeline, timeSeconds, deps.getCanonicalFps());
      deps.onDeterministicSeek(quantized);
      deps.setIsPlaying(false);
      deps.onSyncMedia(quantized, false);
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    getTime: () => Number(deps.getTimeline()?.time() ?? 0),
    getDuration: () => Number(deps.getTimeline()?.duration() ?? 0),
    isPlaying: () => deps.getIsPlaying(),
    setPlaybackRate: (rate: number) => deps.setPlaybackRate(rate),
    getPlaybackRate: () => deps.getPlaybackRate(),
  };
}
