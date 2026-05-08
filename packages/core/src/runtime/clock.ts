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

export class TransportClock {
  private _baseTime = 0;
  private _playStartMs: number | null = null;
  private _rate = 1;
  private _duration = Infinity;
  private _nowMs: () => number;
  private _audioSource: AudioClockSource | null = null;

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

    // Audio-master: when an audio source is attached, derive time
    // from it. Drift is impossible because audio IS the clock.
    if (this._audioSource) {
      let audioTime: number | null = null;
      if ("currentTimeSeconds" in this._audioSource) {
        audioTime = this._audioSource.currentTimeSeconds;
      } else {
        const { el, compositionStart, mediaStart } = this._audioSource;
        if (!el.paused && Number.isFinite(el.currentTime)) {
          audioTime = (el.currentTime - mediaStart) / this._rate + compositionStart;
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

  play(): boolean {
    if (this._playStartMs !== null) return false;
    if (Number.isFinite(this._duration) && this._baseTime >= this._duration) return false;
    this._playStartMs = this._nowMs();
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
