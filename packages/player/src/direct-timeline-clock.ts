/**
 * rAF-based clock that polls a `DirectTimelineAdapter` for current time and
 * drives the player's time/playback-ended callbacks.
 *
 * Used for same-origin standalone GSAP compositions that expose
 * `window.__timelines` but have no runtime bridge — the player drives them
 * directly through the adapter instead of going through postMessage.
 */

import type { DirectTimelineAdapter } from "./timeline-adapters.js";

const UI_UPDATE_INTERVAL_MS = 100;

export interface ClockCallbacks {
  /** Called every ~100ms and on completion with the current time. */
  onTimeUpdate: (currentTime: number, duration: number) => void;
  /** Called when playback reaches the end. Return true to loop (seek+play). */
  onEnded: () => boolean;
  /** Get the current loop flag. */
  getLoop: () => boolean;
  /** Trigger a seek-then-play loop restart. */
  restart: () => void;
  /** Notify that playback has paused (from the timeline side). */
  onPaused: () => void;
}

// A range ending inside the film stops a check early, so the frame past it does not show.
function reachedStop(
  time: number,
  lookAhead: number,
  stop: { end: number; shown: number },
): boolean {
  if (stop.end <= 0) return false;
  const early = stop.shown < stop.end && lookAhead > 0 ? lookAhead : 0;
  return time + early >= stop.end;
}

export class DirectTimelineClock {
  private _raf: number | null = null;
  private _lastUpdateMs = 0;
  private _tick: (() => void) | null = null;

  constructor(private readonly _callbacks: ClockCallbacks) {}

  start(
    timeline: DirectTimelineAdapter,
    getCurrentTime: () => number,
    getDuration: () => number,
    isPaused: () => boolean,
    getStop: () => { end: number; shown: number },
  ): void {
    this.stop();
    let lastTime: number | null = null;
    let lastStep = 0;

    const tick = () => {
      if (isPaused()) {
        this._raf = null;
        return;
      }

      let currentTime: number;
      try {
        currentTime = timeline.time();
      } catch {
        this._raf = null;
        return;
      }

      const duration = getDuration();
      const stop = getStop();
      if (stop.end > 0) currentTime = Math.min(currentTime, stop.end);

      // The smaller of the last two steps, so one slow frame or a jump does not end the range early.
      const step = lastTime === null ? 0 : currentTime - lastTime;
      const completedPlayback = reachedStop(currentTime, Math.min(step, lastStep), stop);
      lastTime = currentTime;
      lastStep = step;
      if (completedPlayback) currentTime = stop.shown;
      const now = performance.now();

      if (now - this._lastUpdateMs > UI_UPDATE_INTERVAL_MS || completedPlayback) {
        this._lastUpdateMs = now;
        this._callbacks.onTimeUpdate(currentTime, duration);
      }

      if (completedPlayback) {
        if (this._callbacks.getLoop()) {
          this._callbacks.restart();
          return;
        }
        try {
          timeline.pause();
          if (stop.shown < stop.end) timeline.seek(stop.shown, false);
        } catch {
          /* ignore */
        }
        this._callbacks.onPaused();
        this._raf = null;
        return;
      }

      this._raf = requestAnimationFrame(tick);
    };

    this._tick = tick;
    this._raf = requestAnimationFrame(tick);
  }

  /** Runs one check now, for a hidden tab, which runs no animation frames. */
  poll(): void {
    if (this._raf === null || !this._tick) return;
    cancelAnimationFrame(this._raf);
    this._tick();
  }

  stop(): void {
    if (this._raf === null) return;
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  get isRunning(): boolean {
    return this._raf !== null;
  }
}
