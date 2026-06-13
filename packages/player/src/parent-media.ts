/**
 * Parent-frame media proxy subsystem.
 *
 * Maintains mirror copies of the iframe's timed `<audio>`/`<video>` elements
 * in the parent frame so that mobile browsers — which gate `el.play()` on user
 * activation in the *same* frame — can still produce audible output via proxies
 * the parent controls directly.
 *
 * See the class-level JSDoc on `HyperframesPlayer` for the full ownership model.
 */

import { selectMediaObserverTargets } from "./mediaObserverScope.js";

/** Minimum absolute drift before a currentTime correction is attempted. */
const MIRROR_DRIFT_THRESHOLD_SECONDS = 0.05;

/**
 * How many *consecutive* over-threshold samples are required before issuing a
 * `currentTime` write. Absorbs single-sample jitter (GC pause, slow bridge
 * tick) without thrashing. Forced calls bypass this gate.
 *
 * Worst-case correction latency ≈ this × bridgeMaxPostIntervalMs (80 ms in
 * core/runtime/state.ts) = 160 ms — well under human A/V re-sync tolerance.
 */
const MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES = 2;

export interface ProxyEntry {
  el: HTMLMediaElement;
  start: number;
  duration: number;
  /**
   * Count of consecutive steady-state samples in which the proxy's
   * `currentTime` was found drifted beyond `MIRROR_DRIFT_THRESHOLD_SECONDS`.
   * Reset on every in-threshold sample. A write is only issued once this
   * reaches `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES`, absorbing
   * single-sample jitter without thrashing.
   */
  driftSamples: number;
}

export class ParentMediaManager {
  private _entries: ProxyEntry[] = [];
  private _mediaObserver?: MutationObserver;
  private _playbackErrorPosted = false;
  private _audioOwner: "runtime" | "parent" = "runtime";
  /** The proxy created from the `audio-src` attribute, tracked so it can be
   *  replaced or cleared instead of accumulating on every attribute change. */
  private _urlAudioEntry: ProxyEntry | null = null;
  private _urlAudioSrc: string | null = null;

  private readonly _dispatchEvent: (event: Event) => void;
  private readonly _getMuted: () => boolean;
  private readonly _getVolume: () => number;
  private readonly _getPlaybackRate: () => number;
  private readonly _getCurrentTime: () => number;
  private readonly _isPaused: () => boolean;

  constructor(opts: {
    dispatchEvent: (event: Event) => void;
    getMuted: () => boolean;
    getVolume: () => number;
    getPlaybackRate: () => number;
    getCurrentTime: () => number;
    isPaused: () => boolean;
  }) {
    this._dispatchEvent = opts.dispatchEvent;
    this._getMuted = opts.getMuted;
    this._getVolume = opts.getVolume;
    this._getPlaybackRate = opts.getPlaybackRate;
    this._getCurrentTime = opts.getCurrentTime;
    this._isPaused = opts.isPaused;
  }

  get audioOwner(): "runtime" | "parent" {
    return this._audioOwner;
  }

  /** Exposed for test instrumentation only — do not use in production code. */
  get entries(): ProxyEntry[] {
    return this._entries;
  }

  resetForIframeLoad(): void {
    this._playbackErrorPosted = false;
    const wasPromoted = this._audioOwner === "parent";
    this._audioOwner = "runtime";
    this.pauseAll();
    this.teardownObserver();
    if (wasPromoted) {
      this._dispatchEvent(
        new CustomEvent("audioownershipchange", {
          detail: { owner: "runtime", reason: "iframe-reload" },
        }),
      );
    }
  }

  destroy(): void {
    this.teardownObserver();
    for (const m of this._entries) {
      m.el.pause();
      m.el.src = "";
    }
    this._entries = [];
    this._urlAudioEntry = null;
    this._urlAudioSrc = null;
  }

  updateMuted(muted: boolean): void {
    for (const m of this._entries) m.el.muted = muted;
  }

  updateVolume(volume: number): void {
    for (const m of this._entries) m.el.volume = volume;
  }

  updatePlaybackRate(rate: number): void {
    for (const m of this._entries) m.el.playbackRate = rate;
  }

  playAll(): void {
    for (const m of this._entries) {
      if (!m.el.src) continue;
      m.el.play().catch((err: unknown) => this._reportPlaybackError(err));
    }
  }

  pauseAll(): void {
    for (const m of this._entries) m.el.pause();
  }

  seekAll(timeInSeconds: number): void {
    for (const m of this._entries) {
      const relTime = timeInSeconds - m.start;
      if (relTime >= 0 && relTime < m.duration) m.el.currentTime = relTime;
    }
  }

  /**
   * Mirror parent-proxy `currentTime` to the iframe timeline, with optional
   * jitter-coalescing. Pass `{ force: true }` for alignment moments (ownership
   * promotion, new proxy initialization) where drift must be corrected
   * immediately.
   */
  mirrorTime(timelineSeconds: number, options?: { force?: boolean }): void {
    const force = options?.force === true;
    for (const m of this._entries) {
      const relTime = timelineSeconds - m.start;
      if (relTime < 0 || relTime >= m.duration) {
        m.driftSamples = 0;
        continue;
      }
      if (Math.abs(m.el.currentTime - relTime) > MIRROR_DRIFT_THRESHOLD_SECONDS) {
        m.driftSamples += 1;
        if (force || m.driftSamples >= MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES) {
          m.el.currentTime = relTime;
          m.driftSamples = 0;
        }
      } else {
        m.driftSamples = 0;
      }
    }
  }

  /**
   * Take ownership of audible playback in response to the runtime's
   * `media-autoplay-blocked` signal. Idempotent.
   *
   * The caller is responsible for muting the iframe's own media output via the
   * postMessage bridge (`set-media-output-muted`) after calling this.
   */
  /**
   * Take ownership of audible playback. Idempotent. The `onMirror` callback
   * is called with the current timeline time and `{ force: true }` so the
   * caller's mirror implementation runs (enabling test spies on the player
   * to fire). If omitted, `mirrorTime` is called directly.
   */
  promoteToParentProxy(
    iframeDoc: Document | null,
    onMirror?: (t: number, opts: { force: boolean }) => void,
  ): void {
    if (this._audioOwner === "parent") return;
    this._audioOwner = "parent";

    // Synchronously mute iframe media to close the race window.
    if (iframeDoc) {
      for (const el of iframeDoc.querySelectorAll<HTMLMediaElement>("video, audio")) {
        el.muted = true;
      }
    }

    // One-shot alignment — bypass jitter-coalescing gate.
    const t = this._getCurrentTime();
    if (onMirror) onMirror(t, { force: true });
    else this.mirrorTime(t, { force: true });
    if (!this._isPaused()) this.playAll();

    this._dispatchEvent(
      new CustomEvent("audioownershipchange", {
        detail: { owner: "parent", reason: "autoplay-blocked" },
      }),
    );
  }

  /**
   * Set up proxies for all timed media currently in the iframe document, then
   * install a MutationObserver for media added later (sub-composition activation).
   */
  setupFromIframe(iframeDoc: Document): void {
    const mediaEls = iframeDoc.querySelectorAll<HTMLMediaElement>(
      "audio[data-start], video[data-start]",
    );
    for (const iframeEl of mediaEls) this._adoptIframeMedia(iframeEl);
    this._observeDynamicMedia(iframeDoc);
  }

  /**
   * Set (or replace) the parent-frame audio proxy driven by the `audio-src`
   * attribute. Re-setting with a different URL tears down the previous proxy
   * first, so changing `audio-src` swaps the track instead of stacking a
   * second one that keeps preloading and plays in parallel.
   */
  setupFromUrl(audioSrc: string): void {
    if (this._urlAudioSrc === audioSrc && this._urlAudioEntry) return;
    this.teardownUrlAudio();
    const entry = this._createEntry(audioSrc, "audio", 0, Infinity);
    // `_createEntry` returns null when a proxy for this URL already exists
    // (e.g. the composition already adopted the same media). In that case we do
    // not own a proxy, so leave the tracking cleared rather than recording a
    // src with no entry — otherwise teardown would target nothing and the
    // no-op guard would never engage.
    this._urlAudioEntry = entry;
    this._urlAudioSrc = entry ? audioSrc : null;
    // If the parent already owns playback, bring the fresh proxy online so a
    // mid-playback swap is not silent until the next play tick.
    if (entry && this._audioOwner === "parent" && !this._isPaused()) {
      this.mirrorTime(this._getCurrentTime(), { force: true });
      this.playAll();
    }
  }

  /** Tear down the `audio-src` proxy (used when the attribute is removed). */
  teardownUrlAudio(): void {
    const entry = this._urlAudioEntry;
    this._urlAudioEntry = null;
    this._urlAudioSrc = null;
    if (!entry) return;
    entry.el.pause();
    entry.el.src = "";
    const idx = this._entries.indexOf(entry);
    if (idx !== -1) this._entries.splice(idx, 1);
  }

  teardownObserver(): void {
    this._mediaObserver?.disconnect();
    this._mediaObserver = undefined;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _reportPlaybackError(err: unknown): void {
    if (this._playbackErrorPosted) return;
    this._playbackErrorPosted = true;
    this._dispatchEvent(
      new CustomEvent("playbackerror", { detail: { source: "parent-proxy", error: err } }),
    );
  }

  /**
   * Create a parent-frame media element and start preloading it. Returns the
   * new entry, or `null` if a proxy for this src already exists (dedup).
   */
  private _createEntry(
    src: string,
    tag: "audio" | "video",
    start: number,
    duration: number,
  ): ProxyEntry | null {
    if (this._entries.some((m) => m.el.src === src)) return null;

    const el = tag === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    el.src = src;
    el.load();
    el.muted = this._getMuted();
    el.volume = this._getVolume();
    const rate = this._getPlaybackRate();
    if (rate !== 1) el.playbackRate = rate;

    const entry: ProxyEntry = { el, start, duration, driftSamples: 0 };
    this._entries.push(entry);
    return entry;
  }

  /** Resolve an iframe media element's source to an absolute URL, or null. */
  private _resolveIframeMediaSrc(iframeEl: HTMLMediaElement): string | null {
    const rawSrc =
      iframeEl.getAttribute("src") || iframeEl.querySelector("source")?.getAttribute("src");
    return rawSrc ? new URL(rawSrc, iframeEl.ownerDocument.baseURI).href : null;
  }

  // fallow-ignore-next-line complexity
  private _adoptIframeMedia(iframeEl: HTMLMediaElement): void {
    // Skip elements the preloader has demoted — the observer will re-trigger
    // when the preload attribute is promoted to "auto".
    if (iframeEl.preload === "metadata" || iframeEl.preload === "none") return;

    const src = this._resolveIframeMediaSrc(iframeEl);
    if (!src) return;

    const start = parseFloat(iframeEl.getAttribute("data-start") || "0");
    const duration = parseFloat(iframeEl.getAttribute("data-duration") || "Infinity");
    const tag = iframeEl.tagName === "VIDEO" ? ("video" as const) : ("audio" as const);

    const created = this._createEntry(src, tag, start, duration);

    // If already under parent ownership and playing, the new proxy must catch
    // up immediately — bypass the jitter-coalescing gate.
    if (created && this._audioOwner === "parent") {
      this.mirrorTime(this._getCurrentTime(), { force: true });
      if (!this._isPaused() && created.el.src) {
        created.el.play().catch((err: unknown) => this._reportPlaybackError(err));
      }
    }
  }

  private _detachIframeMedia(iframeEl: HTMLMediaElement): void {
    const src = this._resolveIframeMediaSrc(iframeEl);
    if (!src) return;
    const idx = this._entries.findIndex((m) => m.el.src === src);
    if (idx === -1) return;
    const entry = this._entries[idx];
    entry.el.pause();
    entry.el.src = "";
    this._entries.splice(idx, 1);
  }

  private _observeDynamicMedia(doc: Document): void {
    this.teardownObserver();
    if (typeof MutationObserver === "undefined" || !doc.body) return;

    // fallow-ignore-next-line complexity
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "preload") {
          const target = m.target;
          if (
            target instanceof HTMLMediaElement &&
            target.matches("audio[data-start], video[data-start]") &&
            target.preload === "auto"
          ) {
            this._adoptIframeMedia(target);
          }
          continue;
        }

        for (const added of m.addedNodes) {
          if (!(added instanceof Element)) continue;
          const candidates: HTMLMediaElement[] = [];
          if (added.matches?.("audio[data-start], video[data-start]")) {
            candidates.push(added as HTMLMediaElement);
          }
          const inside = added.querySelectorAll?.<HTMLMediaElement>(
            "audio[data-start], video[data-start]",
          );
          if (inside) for (const el of inside) candidates.push(el);
          for (const el of candidates) this._adoptIframeMedia(el);
        }

        for (const removed of m.removedNodes) {
          if (!(removed instanceof Element)) continue;
          const dropped: HTMLMediaElement[] = [];
          if (removed.matches?.("audio[data-start], video[data-start]")) {
            dropped.push(removed as HTMLMediaElement);
          }
          const inside = removed.querySelectorAll?.<HTMLMediaElement>(
            "audio[data-start], video[data-start]",
          );
          if (inside) for (const el of inside) dropped.push(el);
          for (const el of dropped) this._detachIframeMedia(el);
        }
      }
    });

    const observeOpts: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["preload"],
    };

    const targets = selectMediaObserverTargets(doc);
    for (const target of targets) {
      obs.observe(target, observeOpts);
    }
    this._mediaObserver = obs;
  }
}
