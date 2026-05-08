import { swallow } from "./diagnostics";

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
  private _activeSources: ScheduledSource[] = [];
  private _masterGain: GainNode | null = null;
  private _scheduleOffset = 0;
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
    return this._ctx.currentTime - this._scheduleOffset;
  }

  async decodeAudioElement(el: HTMLMediaElement): Promise<AudioBuffer | null> {
    const src = el.currentSrc || el.getAttribute("src");
    if (!src) return null;
    if (this._bufferCache.has(src)) return this._bufferCache.get(src)!;
    if (!this._ctx) return null;
    try {
      const response = await fetch(src);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
      this._bufferCache.set(src, audioBuffer);
      return audioBuffer;
    } catch (err) {
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
  ): Promise<ScheduledSource | null> {
    if (!this._ctx || !this._masterGain) return null;
    if (generation !== this._playGeneration) return null;

    try {
      if (this._ctx.state === "suspended") {
        await this._ctx.resume();
      }
      if (generation !== this._playGeneration) return null;

      const sourceNode = this._ctx.createBufferSource();
      sourceNode.buffer = buffer;

      const gainNode = this._ctx.createGain();
      gainNode.gain.value = volume;
      sourceNode.connect(gainNode);
      gainNode.connect(this._masterGain);

      const offset = Math.max(0, compositionTime - compositionStart + mediaStart);
      const scheduledAt = this._ctx.currentTime;
      this._scheduleOffset = scheduledAt - compositionTime;
      sourceNode.start(0, offset);

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
      return scheduled;
    } catch (err) {
      swallow("webAudioTransport.schedule", err);
      return null;
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
