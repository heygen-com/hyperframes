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
    }
  | {
      currentTimeSeconds: number;
    };

/** GSAP's own `lagSmoothing` default — see the PR body for why this clock needs its own copy. */
const STALL_THRESHOLD_MS = 500;
const STALL_ADJUSTED_LAG_MS = 33;

export class TransportClock {
  private _baseTime = 0;
  private _playStartMs: number | null = null;
  private _rate = 1;
  private _duration = Infinity;
  private _nowMs: () => number;
  private _audioSource: AudioClockSource | null = null;
  /** Wall-clock time of the last `now()` read while playing; null while paused. */
  private _lastReadMs: number | null = null;

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

    this._applyStallCorrection();

    // Audio-master: when an audio source is attached, derive time
    // from it. Drift is impossible because audio IS the clock.
    if (this._audioSource) {
      let audioTime: number | null = null;
      if ("currentTimeSeconds" in this._audioSource) {
        audioTime = this._audioSource.currentTimeSeconds;
      } else {
        const { el, compositionStart, mediaStart } = this._audioSource;
        if (!el.paused && Number.isFinite(el.currentTime)) {
          audioTime =
            ((el.currentTime - mediaStart) / (el.playbackRate > 0 ? el.playbackRate : 1)) *
              this._rate +
            compositionStart;
        }
      }
      if (audioTime !== null) {
        if (Number.isFinite(this._duration) && audioTime >= this._duration) {
          return this._duration;
        }
        return Math.max(0, audioTime);
      }
    }

    // Monotonic fallback
    const elapsed = (this._nowMs() - this._playStartMs) / 1000;
    const t = this._baseTime + elapsed * this._rate;
    if (Number.isFinite(this._duration) && t >= this._duration) {
      return this._duration;
    }
    return Math.max(0, t);
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
