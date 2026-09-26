import { timeAtSourceTime, type RateSpec } from "../speedRamp.js";
import { MEDIA_HARD_SYNC_SECONDS } from "./media.js";

export type TransportClockSnapshot = {
  time: number;
  playing: boolean;
  rate: number;
  duration: number;
  source: "monotonic" | "audio";
};

export type AudioClockSource =
  | {
      el: HTMLMediaElement;
      compositionStart: number;
      mediaStart: number;
      /** The clip's rate lane; a constant rate is read from `el.playbackRate`. */
      rate?: RateSpec;
    }
  | {
      currentTimeSeconds: number;
    };

/** GSAP's own `lagSmoothing` default — see the PR body for why this clock needs its own copy. */
const STALL_THRESHOLD_MS = 500;
const STALL_ADJUSTED_LAG_MS = 33;
/** `HTMLMediaElement.HAVE_FUTURE_DATA`, spelled out so the clock runs without a DOM. */
const HAVE_FUTURE_DATA = 3;

export class TransportClock {
  private _baseTime = 0;
  private _playStartMs: number | null = null;
  private _rate = 1;
  private _duration = Infinity;
  private _nowMs: () => number;
  private _audioSource: AudioClockSource | null = null;
  /** Wall-clock time of the last `now()` read while playing; null while paused. */
  private _lastReadMs: number | null = null;
  /** The time the last read reported while playing; audio may hold it, never push it back. */
  private _lastNow = 0;

  constructor(opts?: {
    initialTime?: number;
    rate?: number;
    duration?: number;
    nowMs?: () => number;
  }) {
    this._baseTime = opts?.initialTime ?? 0;
    this._rate = opts?.rate ?? 1;
    this._duration = opts?.duration ?? Infinity;
    this._nowMs = opts?.nowMs ?? (() => performance.now());
  }

  now(): number {
    if (this._playStartMs === null) return this._baseTime;

    // Audio-master: drift is impossible because audio IS the clock. Clearing
    // `_lastReadMs` (not stamping it) means the next monotonic read starts
    // fresh from `_playStartMs` instead of a timestamp audio just made
    // meaningless — see the PR body.
    if (this._audioSource) {
      let audioTime: number | null = null;
      if ("currentTimeSeconds" in this._audioSource) {
        audioTime = this._audioSource.currentTimeSeconds;
      } else {
        audioTime = this._elementTime(this._audioSource);
      }
      if (audioTime !== null) {
        const t = Number.isFinite(this._duration) ? Math.min(audioTime, this._duration) : audioTime;
        // Re-anchored so a fallback read continues from here, not from the last play().
        this._baseTime = Math.max(0, t);
        this._playStartMs = this._nowMs();
        this._lastReadMs = null;
        this._lastNow = this._baseTime;
        return this._baseTime;
      }
    }

    // Monotonic fallback
    this._applyStallCorrection();
    const elapsed = (this._nowMs() - this._playStartMs) / 1000;
    const t = this._baseTime + elapsed * this._rate;
    this._lastNow = Math.max(0, Number.isFinite(this._duration) ? Math.min(t, this._duration) : t);
    return this._lastNow;
  }

  /**
   * The element's composition time, or null when it cannot lead the playhead.
   * Audio may pull the playhead forward, or hold it while it catches up (a clip
   * still starting, seeking or buffering), but never push it back.
   */
  private _elementTime(source: Extract<AudioClockSource, { el: HTMLMediaElement }>): number | null {
    const { el, compositionStart, mediaStart, rate } = source;
    if (el.paused || !Number.isFinite(el.currentTime)) return null;
    if (el.seeking) return this._lastNow;
    const time =
      typeof rate === "object"
        ? timeAtSourceTime(rate, el.currentTime - mediaStart) + compositionStart
        : ((el.currentTime - mediaStart) / (el.playbackRate > 0 ? el.playbackRate : 1)) *
            this._rate +
          compositionStart;
    if (time >= this._lastNow) return time;
    // A jump back past a hard sync (a native loop wrap) is not where the audio is heard.
    const buffering = el.readyState < HAVE_FUTURE_DATA;
    return buffering || this._lastNow - time <= MEDIA_HARD_SYNC_SECONDS ? this._lastNow : null;
  }

  /** Folds a >500ms gap since the last read into `_playStartMs` so it's never reported as played time. */
  private _applyStallCorrection(): void {
    if (this._playStartMs === null) return;
    const nowMs = this._nowMs();
    if (this._lastReadMs !== null) {
      const gapMs = nowMs - this._lastReadMs;
      if (gapMs > STALL_THRESHOLD_MS) {
        this._playStartMs += gapMs - STALL_ADJUSTED_LAG_MS;
      }
    }
    this._lastReadMs = nowMs;
  }

  play(): boolean {
    if (this._playStartMs !== null) return false;
    if (Number.isFinite(this._duration) && this._baseTime >= this._duration) return false;
    this._playStartMs = this._nowMs();
    this._lastNow = this._baseTime;
    // Not a stall: the gap since the clock was last read (possibly a long
    // paused idle) says nothing about lost playback time, since none was
    // playing. `_applyStallCorrection` treats null as "nothing to compare
    // against yet" and starts the window fresh from the next read.
    this._lastReadMs = null;
    return true;
  }

  pause(): boolean {
    if (this._playStartMs === null) return false;
    this._baseTime = this.now();
    this._playStartMs = null;
    return true;
  }

  seek(timeSeconds: number): void {
    const clamped = Number.isFinite(this._duration)
      ? Math.max(0, Math.min(timeSeconds, this._duration))
      : Math.max(0, timeSeconds);
    this._baseTime = clamped;
    this._lastNow = clamped;
    if (this._playStartMs !== null) {
      this._playStartMs = this._nowMs();
      // Same reasoning as `play()`: the seek itself, not any elapsed gap
      // since the last read, is why the reported time is moving now.
      this._lastReadMs = null;
    }
  }

  isPlaying(): boolean {
    return this._playStartMs !== null;
  }

  setRate(rate: number): void {
    const safe = Number.isFinite(rate) && rate > 0 ? Math.max(0.1, Math.min(5, rate)) : 1;
    if (this._playStartMs !== null) {
      this._baseTime = this.now();
      this._playStartMs = this._nowMs();
      this._lastReadMs = null;
    }
    this._rate = safe;
  }

  getRate(): number {
    return this._rate;
  }

  setDuration(duration: number): void {
    this._duration = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    if (this._baseTime > this._duration) {
      this._baseTime = this._duration;
    }
  }

  getDuration(): number {
    return this._duration;
  }

  attachAudioSource(source: AudioClockSource): void {
    this._audioSource = source;
  }

  detachAudioSource(): void {
    if (this._audioSource && this._playStartMs !== null) {
      this._baseTime = this.now();
      this._playStartMs = this._nowMs();
      // Falling back to monotonic timing fresh, same reasoning as `play()`:
      // any gap while audio was the time source is not a monotonic stall.
      this._lastReadMs = null;
    }
    this._audioSource = null;
  }

  /** The element the playhead currently follows, if the source is one. */
  audioElement(): HTMLMediaElement | null {
    return this._audioSource && "el" in this._audioSource ? this._audioSource.el : null;
  }

  hasAudioSource(): boolean {
    return this._audioSource !== null;
  }

  getSource(): "monotonic" | "audio" {
    if (this._audioSource && this._playStartMs !== null) {
      if ("currentTimeSeconds" in this._audioSource) return "audio";
      const { el } = this._audioSource;
      if (!el.paused && Number.isFinite(el.currentTime)) return "audio";
    }
    return "monotonic";
  }

  snapshot(): TransportClockSnapshot {
    return {
      time: this.now(),
      playing: this.isPlaying(),
      rate: this._rate,
      duration: this._duration,
      source: this.getSource(),
    };
  }

  reachedEnd(): boolean {
    return Number.isFinite(this._duration) && this.now() >= this._duration;
  }
}
