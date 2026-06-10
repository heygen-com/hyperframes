import { swallow } from "./diagnostics";

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
}

export type ScheduledSource = {
  el: HTMLMediaElement;
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  compositionStart: number;
  mediaStart: number;
  scheduledAt: number;
  priorMuted: boolean;
};

export class WebAudioTransport {
  private _ctx: AudioContext | null = null;
  private _bufferCache = new Map<string, AudioBuffer>();
  private _failedSrcs = new Set<string>();
  private _activeSources: ScheduledSource[] = [];
  private _masterGain: GainNode | null = null;
  // Composition-time reference frame: at AudioContext time `_rateAnchorCtx`,
  // composition time was `_rateAnchorComp`, and time has been advancing at
  // `_rate` composition-seconds per wallclock-second since.
  private _rateAnchorCtx = 0;
  private _rateAnchorComp = 0;
  private _rate = 1;
  private _paused = true;
  private _playGeneration = 0;

  async init(): Promise<boolean> {
    try {
      this._ctx = new AudioContext();
      this._masterGain = this._ctx.createGain();
      this._masterGain.connect(this._ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  get context(): AudioContext | null {
    return this._ctx;
  }

  getTime(): number {
    if (!this._ctx || this._paused) return -1;
    return this._rateAnchorComp + (this._ctx.currentTime - this._rateAnchorCtx) * this._rate;
  }

  async decodeAudioElement(el: HTMLMediaElement): Promise<AudioBuffer | null> {
    const src = el.currentSrc || el.getAttribute("src");
    if (!src) return null;
    if (this._bufferCache.has(src)) return this._bufferCache.get(src)!;
    if (this._failedSrcs.has(src)) return null;
    if (!this._ctx) return null;
    try {
      const response = await fetch(src);
      if (!response.ok) {
        this._failedSrcs.add(src);
        swallow("webAudioTransport.fetch", new Error(`${response.status} ${src}`));
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
      this._bufferCache.set(src, audioBuffer);
      return audioBuffer;
    } catch (err) {
      this._failedSrcs.add(src);
      swallow("webAudioTransport.decode", err);
      return null;
    }
  }

  startGeneration(): number {
    this._playGeneration += 1;
    return this._playGeneration;
  }

  currentGeneration(): number {
    return this._playGeneration;
  }

  async schedulePlayback(
    el: HTMLMediaElement,
    buffer: AudioBuffer,
    compositionStart: number,
    mediaStart: number,
    compositionTime: number,
    volume: number,
    generation: number,
    rate = 1,
  ): Promise<ScheduledSource | null> {
    if (!this._ctx || !this._masterGain) return null;
    if (generation !== this._playGeneration) return null;

    try {
      if (this._ctx.state === "suspended") {
        await this._ctx.resume();
      }
      if (generation !== this._playGeneration) return null;

      const safeRate = normalizeRate(rate);

      const sourceNode = this._ctx.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.playbackRate.value = safeRate;

      const gainNode = this._ctx.createGain();
      gainNode.gain.value = volume;
      sourceNode.connect(gainNode);
      gainNode.connect(this._masterGain);

      const elapsed = compositionTime - compositionStart;
      const scheduledAt = this._ctx.currentTime;
      this._rate = safeRate;
      this._rateAnchorCtx = scheduledAt;
      this._rateAnchorComp = compositionTime;

      if (elapsed >= 0) {
        sourceNode.start(0, elapsed + mediaStart);
      } else {
        const delay = -elapsed / safeRate;
        sourceNode.start(scheduledAt + delay, mediaStart);
      }

      const priorMuted = el.muted;
      el.muted = true;

      const scheduled: ScheduledSource = {
        el,
        sourceNode,
        gainNode,
        compositionStart,
        mediaStart,
        scheduledAt,
        priorMuted,
      };
      this._activeSources.push(scheduled);
      this._paused = false;

      sourceNode.addEventListener("ended", () => {
        const idx = this._activeSources.indexOf(scheduled);
        if (idx !== -1) {
          this._activeSources.splice(idx, 1);
          el.muted = priorMuted;
          if (this._activeSources.length === 0) this._paused = true;
        }
      });

      return scheduled;
    } catch (err) {
      swallow("webAudioTransport.schedule", err);
      return null;
    }
  }

  /**
   * Rebases the composition-time reference frame before swapping rate so
   * `getTime()` stays continuous across the change. Sources scheduled to
   * start in the future keep their original wallclock start time — callers
   * that need rate-correct future starts should `stopAll()` and reschedule.
   */
  setRate(rate: number): void {
    const safeRate = normalizeRate(rate);
    if (safeRate === this._rate) return;
    if (this._ctx && !this._paused) {
      this._rateAnchorComp = this.getTime();
      this._rateAnchorCtx = this._ctx.currentTime;
    }
    this._rate = safeRate;
    for (const source of this._activeSources) {
      try {
        source.sourceNode.playbackRate.value = safeRate;
      } catch (err) {
        swallow("webAudioTransport.setRate", err);
      }
    }
  }

  stopAll(): void {
    for (const source of this._activeSources) {
      try {
        source.sourceNode.stop();
        source.sourceNode.disconnect();
        source.gainNode.disconnect();
      } catch {
        // already stopped
      }
      source.el.muted = source.priorMuted;
    }
    this._activeSources = [];
    this._paused = true;
  }

  setVolume(volume: number): void {
    if (this._masterGain) {
      this._masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  setElementVolume(el: HTMLMediaElement, volume: number): void {
    const safeVolume = Math.max(0, Math.min(1, volume));
    for (const source of this._activeSources) {
      if (source.el !== el) continue;
      try {
        source.gainNode.gain.value = safeVolume;
      } catch (err) {
        swallow("webAudioTransport.setElementVolume", err);
      }
    }
  }

  setMuted(muted: boolean): void {
    if (this._masterGain) {
      this._masterGain.gain.value = muted ? 0 : 1;
    }
  }

  isActive(): boolean {
    return this._activeSources.length > 0 && !this._paused;
  }

  destroy(): void {
    this.stopAll();
    this._bufferCache.clear();
    if (this._ctx) {
      try {
        void this._ctx.close();
      } catch {
        // ignore
      }
    }
    this._ctx = null;
    this._masterGain = null;
  }
}
