import { swallow } from "./diagnostics";
import { getDebugSurface } from "./globals.js";

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
}

/**
 * Breadcrumb for the per-element-mute handoff: the transport just claimed a track
 * that was audibly playing through the HTMLMedia fallback. Quiet unless
 * `__hfDebug` — a hook for diagnosing the race if it ever regresses.
 */
function logFallbackHandoff(el: HTMLMediaElement, priorMuted: boolean): void {
  if (priorMuted || el.paused || !getDebugSurface().__hfDebug) return;
  // eslint-disable-next-line no-console -- intentional debug surface
  console.debug(
    "[hyperframes] webAudioTransport claimed fallback-playing element:",
    el.currentSrc || el.getAttribute("src") || "",
  );
}

/**
 * Start a buffer source, bounding it to the clip's authored window
 * (`data-duration`) so a trimmed clip stops at its edge instead of running the
 * buffer to the source file's natural end. `clipSourceLen` is the clip span in
 * buffer seconds; the third `start()` arg is the portion to play from the
 * offset. An infinite `clipDuration` plays unbounded (legacy behavior).
 *
 * Returns false when the playhead is already past the clip end (nothing to
 * play); the caller should discard the source.
 */
function startBoundedSource(
  node: AudioBufferSourceNode,
  opts: {
    elapsed: number;
    mediaStart: number;
    scheduledAt: number;
    safeRate: number;
    clipDuration: number;
  },
): boolean {
  const { elapsed, mediaStart, scheduledAt, safeRate, clipDuration } = opts;
  const hasBound = Number.isFinite(clipDuration) && clipDuration > 0;
  const clipSourceLen = clipDuration * safeRate;
  if (elapsed >= 0) {
    const remaining = clipSourceLen - elapsed;
    if (hasBound && remaining <= 0) return false;
    if (hasBound) node.start(0, elapsed + mediaStart, remaining);
    else node.start(0, elapsed + mediaStart);
    return true;
  }
  const delay = -elapsed / safeRate;
  if (hasBound) node.start(scheduledAt + delay, mediaStart, clipSourceLen);
  else node.start(scheduledAt + delay, mediaStart);
  return true;
}

export type ScheduledSource = {
  el: HTMLMediaElement;
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  compositionStart: number;
  mediaStart: number;
  scheduledAt: number;
  priorMuted: boolean;
  // The clip had a finite window, so start() was given a fixed duration in
  // buffer-sample seconds. That bound can't be rescaled in place on a rate
  // change — callers must stopAll()+reschedule (see hasBoundedActiveSources).
  bounded: boolean;
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

    // Fetch the bytes. A network error or non-OK status (e.g. a 404 for an
    // asset that simply has not been uploaded yet) is TRANSIENT — return null
    // WITHOUT blacklisting, so the next play/seek generation retries once the
    // asset becomes available. (Previously these were added to `_failedSrcs`,
    // which is never cleared, permanently silencing a merely-late track.)
    let arrayBuffer: ArrayBuffer;
    try {
      // `no-store`: a retry must actually re-request the asset — not replay a
      // cached 404/stale response from the failed attempt that we chose not to
      // blacklist.
      const response = await fetch(src, { cache: "no-store" });
      if (!response.ok) {
        swallow("webAudioTransport.fetch", new Error(`${response.status} ${src}`));
        return null;
      }
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      swallow("webAudioTransport.fetch", err);
      return null;
    }

    // A decode failure means the bytes themselves are unusable (corrupt or an
    // unsupported codec) — that IS permanent, so blacklist to avoid re-decoding
    // the same bad payload on every generation.
    try {
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
    clipDuration = Number.POSITIVE_INFINITY,
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

      if (
        !startBoundedSource(sourceNode, {
          elapsed,
          mediaStart,
          scheduledAt,
          safeRate,
          clipDuration,
        })
      ) {
        // Playhead already past the clip end — discard the nodes we built.
        sourceNode.disconnect();
        gainNode.disconnect();
        return null;
      }

      const priorMuted = el.muted;
      el.muted = true;
      logFallbackHandoff(el, priorMuted);

      const scheduled: ScheduledSource = {
        el,
        sourceNode,
        gainNode,
        compositionStart,
        mediaStart,
        scheduledAt,
        priorMuted,
        bounded: Number.isFinite(clipDuration) && clipDuration > 0,
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
  setRate(rate: number): boolean {
    const safeRate = normalizeRate(rate);
    if (safeRate === this._rate) return false;
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
    return true;
  }

  // A bounded source's wall-clock duration was baked into start()'s duration
  // arg at its original rate; a later rate change can't rescale it in place, so
  // the caller must stopAll()+reschedule to keep trimmed clips ending on time.
  hasBoundedActiveSources(): boolean {
    return this._activeSources.some((s) => s.bounded);
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

  /** Whether the transport currently plays THIS element (the runtime mutes it to
   *  avoid double audio; an unclaimed track stays audible). */
  ownsElement(el: HTMLMediaElement): boolean {
    return !this._paused && this._activeSources.some((s) => s.el === el);
  }

  destroy(): void {
    this.stopAll();
    this._bufferCache.clear();
    this._failedSrcs.clear();
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
