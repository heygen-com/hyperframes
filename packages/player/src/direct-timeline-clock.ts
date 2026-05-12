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

export class DirectTimelineClock {
  private _raf: number | null = null;
  private _lastUpdateMs = 0;

  constructor(private readonly _callbacks: ClockCallbacks) {}

  start(
    timeline: DirectTimelineAdapter,
    getCurrentTime: () => number,
    getDuration: () => number,
    isPaused: () => boolean,
  ): void {
    this.stop();

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
      if (duration > 0) currentTime = Math.min(currentTime, duration);

      const completedPlayback = duration > 0 && currentTime >= duration;
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
        } catch {
          /* ignore */
        }
        this._callbacks.onPaused();
        this._raf = null;
        return;
      }

      this._raf = requestAnimationFrame(tick);
    };

    this._raf = requestAnimationFrame(tick);
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
