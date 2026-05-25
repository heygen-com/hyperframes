/**
 * Playback adapter utilities: factory for the static-seek adapter used when a
 * composition exposes only a `renderSeek` / `seek` API (no native play/pause
 * support), plus a thin wrapper that normalises GSAP-style `TimelineLike`
 * objects to the `PlaybackAdapter` interface.
 */

import type {
  PlaybackAdapter,
  RuntimePlaybackAdapter,
  StaticSeekPlaybackClock,
  TimelineLike,
} from "./playbackTypes";

// ---------------------------------------------------------------------------
// Pure numeric helpers
// ---------------------------------------------------------------------------

export function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampTime(time: number, duration: number): number {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  return safeDuration > 0 ? Math.min(safeTime, safeDuration) : safeTime;
}

export function getAdapterDuration(adapter: PlaybackAdapter | null | undefined): number {
  if (!adapter) return 0;
  try {
    const duration = Number(adapter.getDuration());
    return isFinitePositive(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Clock factory
// ---------------------------------------------------------------------------

export function getDefaultStaticSeekPlaybackClock(win: Window): StaticSeekPlaybackClock {
  return {
    now: () => win.performance.now(),
    requestAnimationFrame: (callback) => win.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => win.cancelAnimationFrame(handle),
  };
}

// ---------------------------------------------------------------------------
// Static-seek adapter
// ---------------------------------------------------------------------------

/**
 * Wraps a render-only player (exposes `renderSeek`/`seek` but no native
 * play/pause) and drives playback via `requestAnimationFrame`.
 */
export function createStaticSeekPlaybackAdapter(
  player: Pick<RuntimePlaybackAdapter, "getTime"> &
    Partial<Pick<RuntimePlaybackAdapter, "renderSeek" | "seek">>,
  duration: number,
  clock: StaticSeekPlaybackClock,
  getPlaybackRate: () => number = () => 1,
): PlaybackAdapter {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  let currentTime = clampTime(Number(player.getTime?.() ?? 0), safeDuration);
  let playing = false;
  let rafId = 0;
  let playStartTime = currentTime;
  let playStartNow = clock.now();

  const renderSeek = (time: number) => {
    currentTime = clampTime(time, safeDuration);
    if (typeof player.renderSeek === "function") {
      player.renderSeek(currentTime);
      return;
    }
    player.seek?.(currentTime);
  };

  const stopTicker = () => {
    if (rafId) {
      clock.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const tick: FrameRequestCallback = (now) => {
    if (!playing) return;
    const playbackRate = Math.max(0.1, Number(getPlaybackRate()) || 1);
    const elapsed = ((now - playStartNow) / 1000) * playbackRate;
    renderSeek(playStartTime + elapsed);
    if (currentTime >= safeDuration) {
      playing = false;
      rafId = 0;
      return;
    }
    rafId = clock.requestAnimationFrame(tick);
  };

  return {
    play: () => {
      if (playing || safeDuration <= 0) return;
      if (currentTime >= safeDuration) renderSeek(0);
      playing = true;
      playStartTime = currentTime;
      playStartNow = clock.now();
      stopTicker();
      rafId = clock.requestAnimationFrame(tick);
    },
    pause: () => {
      playing = false;
      stopTicker();
    },
    seek: (time) => {
      renderSeek(time);
      if (playing) {
        playStartTime = currentTime;
        playStartNow = clock.now();
      }
    },
    getTime: () => currentTime,
    getDuration: () => safeDuration,
    isPlaying: () => playing,
  };
}

// ---------------------------------------------------------------------------
// GSAP timeline wrapper
// ---------------------------------------------------------------------------

export function wrapTimeline(tl: TimelineLike): PlaybackAdapter {
  return {
    play: () => tl.play(),
    pause: () => tl.pause(),
    seek: (t, options) => {
      const shouldPause = !options?.keepPlaying;
      if (shouldPause) tl.pause();
      tl.seek(t);
      if (shouldPause) tl.pause();
    },
    getTime: () => tl.time(),
    getDuration: () => tl.duration(),
    isPlaying: () => tl.isActive(),
  };
}
