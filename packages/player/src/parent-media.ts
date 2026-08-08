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
import { isRealmElement, isRealmHtmlMediaElement } from "./media-element-guards.js";
import { readClipTiming } from "@hyperframes/core/composition-contract";

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

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function readAuthorVolume(source: HTMLMediaElement): number {
  const raw = Number.parseFloat(source.dataset.volume ?? "");
  return clampVolume(Number.isFinite(raw) ? raw : 1);
}

function readMediaStart(source: HTMLMediaElement): number {
  const raw = Number.parseFloat(source.dataset.playbackStart ?? source.dataset.mediaStart ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function normalizePlaybackRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? Math.max(0.1, Math.min(5, rate)) : 1;
}

function readAuthorPlaybackRate(source: HTMLMediaElement): number {
  const authored = Number.parseFloat(source.dataset.playbackRate ?? "");
  return normalizePlaybackRate(
    Number.isFinite(authored) && authored > 0 ? authored : source.defaultPlaybackRate,
  );
}

export interface ProxyEntry {
  el: HTMLMediaElement;
  start: number;
  duration: number;
  /** Offset into the source media at the start of the timeline clip. Defaults to 0. */
  mediaStart?: number;
  /** Per-track authored gain before global volume is applied. Defaults to 1. */
  authorVolume?: number;
  /** Per-clip source playback rate before global playback rate. Defaults to 1. */
  authorPlaybackRate?: number;
  /**
   * The iframe media element this proxy mirrors, when adopted from the DOM.
   * Its timing, media offset, authored volume, and authored playback rate are
   * re-read each tick so live edits stay reflected. Null for URL-driven proxies.
   */
  source?: HTMLMediaElement | null;
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
  private _userVolume: number;

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
    this._userVolume = clampVolume(opts.getVolume());
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
    this._userVolume = clampVolume(this._getVolume());
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
    this._audioOwner = "runtime";
    this._playbackErrorPosted = false;
    this._userVolume = clampVolume(this._getVolume());
  }

  updateMuted(muted: boolean): void {
    for (const m of this._entries) m.el.muted = muted;
  }

  updateVolume(volume: number): void {
    const userVolume = clampVolume(volume);
    for (const m of this._entries) {
      this._refreshEntryContract(m);
      if (m.source?.isConnected) {
        // The iframe runtime owns GSAP volume envelopes and will publish the
        // authoritative effective gain on `source.volume`. Never reconstruct
        // that envelope from the static data-volume attribute. A zero player
        // volume is safe to apply immediately; non-zero changes keep the last
        // effective gain until the runtime's next state tick reaches us.
        if (userVolume === 0) m.el.volume = 0;
      } else {
        m.el.volume = clampVolume((m.authorVolume ?? 1) * userVolume);
      }
    }
    this._userVolume = userVolume;
  }

  updatePlaybackRate(rate: number): void {
    const globalPlaybackRate = normalizePlaybackRate(rate);
    for (const m of this._entries) {
      this._refreshEntryContract(m);
      m.el.playbackRate = (m.authorPlaybackRate ?? 1) * globalPlaybackRate;
    }
  }

  private _playEntry(m: ProxyEntry): void {
    if (!m.el.src) return;
    m.el.play().catch((err: unknown) => this._reportPlaybackError(err));
  }

  // Play only if the current playhead is inside the clip's (live) window, so
  // bulk starts (playAll / adopt) don't blip audio for clips outside their
  // window until the next mirrorTime tick gates them off.
  private _playEntryIfActive(m: ProxyEntry): void {
    this._refreshEntryContract(m);
    const relTime = this._getCurrentTime() - m.start;
    if (relTime < 0 || relTime >= m.duration) return;
    this._syncEntryVolume(m);
    this._syncEntryPlaybackRate(m);
    this._playEntry(m);
  }

  // Re-read the source clip's live contract so edits made after adoption are
  // reflected by the proxy. URL-driven entries have no source and retain the
  // defaults captured at creation.
  private _refreshEntryContract(m: ProxyEntry): void {
    if (!m.source?.isConnected) return;
    // Guard against a malformed (non-numeric) attribute parsing to NaN: an NaN
    // duration makes every `relTime >= m.duration` window check false, so the
    // gate never closes and the proxy plays past its clip end.
    const timing = readClipTiming(m.source);
    m.start = timing.start ?? 0;
    m.duration =
      timing.duration != null && timing.duration > 0 ? timing.duration : Number.POSITIVE_INFINITY;
    m.mediaStart = readMediaStart(m.source);
    m.authorVolume = readAuthorVolume(m.source);
    m.authorPlaybackRate = readAuthorPlaybackRate(m.source);
  }

  // The runtime owns animation envelopes and writes their effective gain to
  // the iframe media element. Copy that value directly: it already includes
  // the player's global volume, so multiplying it again would attenuate the
  // proxy twice. Entries without a live source use their authored ratio.
  private _syncEntryVolume(m: ProxyEntry): void {
    // Keep zero authoritative while the iframe's set-volume message is still
    // in flight; otherwise a mirror tick could briefly restore stale audio.
    if (this._userVolume === 0) {
      m.el.volume = 0;
      return;
    }
    if (m.source?.isConnected) {
      m.el.volume = clampVolume(m.source.volume);
      return;
    }
    m.el.volume = clampVolume((m.authorVolume ?? 1) * this._userVolume);
  }

  private _syncEntryPlaybackRate(m: ProxyEntry): void {
    m.el.playbackRate =
      (m.authorPlaybackRate ?? 1) * normalizePlaybackRate(this._getPlaybackRate());
  }

  private _sourceTime(m: ProxyEntry, relTime: number): number {
    return (m.mediaStart ?? 0) + relTime * (m.authorPlaybackRate ?? 1);
  }

  // Pause the proxy outside its clip window; resume it on re-entry during
  // parent-owned playback. Returns whether the proxy is within the window.
  private _gateEntryPlayback(m: ProxyEntry, relTime: number): boolean {
    if (relTime < 0 || relTime >= m.duration) {
      if (!m.el.paused) m.el.pause();
      m.driftSamples = 0;
      return false;
    }
    if (this._audioOwner === "parent" && !this._isPaused() && m.el.paused) this._playEntry(m);
    return true;
  }

  playAll(): void {
    for (const m of this._entries) this._playEntryIfActive(m);
  }

  pauseAll(): void {
    for (const m of this._entries) m.el.pause();
  }

  stopAdoptedMedia(): void {
    for (const m of this._entries) {
      if (m.source) m.el.pause();
    }
  }

  seekAll(timeInSeconds: number): void {
    for (const m of this._entries) {
      // Re-read live bounds so a trim/move just before a paused scrub gates and
      // positions against the current clip window, not the adopt-time one.
      this._refreshEntryContract(m);
      const relTime = timeInSeconds - m.start;
      if (relTime >= 0 && relTime < m.duration) {
        m.el.currentTime = this._sourceTime(m, relTime);
        this._syncEntryVolume(m);
        this._syncEntryPlaybackRate(m);
      }
    }
  }

  // Audible scrub: position every proxy at `timeInSeconds` AND play the ones whose
  // clip window covers it, so the viewer hears the track under the playhead while
  // dragging the scrubber (vs seekAll, which positions silently). Each drag move
  // re-seeks to the new position, so playback restarts from the playhead and you
  // hear the audio you're scrubbing over. The caller settles back to silence on
  // scrub end (a normal pause+seekAll). Muted proxies stay silent (play() is a no-op
  // for output). Out-of-window proxies are paused.
  scrubAll(timeInSeconds: number): void {
    for (const m of this._entries) {
      this._refreshEntryContract(m);
      const relTime = timeInSeconds - m.start;
      if (relTime >= 0 && relTime < m.duration) {
        m.el.currentTime = this._sourceTime(m, relTime);
        this._syncEntryVolume(m);
        this._syncEntryPlaybackRate(m);
        this._playEntry(m);
      } else if (!m.el.paused) {
        m.el.pause();
      }
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
      this._refreshEntryContract(m);
      const relTime = timelineSeconds - m.start;
      if (!this._gateEntryPlayback(m, relTime)) continue;
      this._syncEntryVolume(m);
      this._syncEntryPlaybackRate(m);
      const mediaTime = this._sourceTime(m, relTime);
      if (Math.abs(m.el.currentTime - mediaTime) > MIRROR_DRIFT_THRESHOLD_SECONDS) {
        m.driftSamples += 1;
        if (force || m.driftSamples >= MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES) {
          m.el.currentTime = mediaTime;
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
      for (const el of iframeDoc.querySelectorAll("video, audio")) {
        if (isRealmHtmlMediaElement(el)) el.muted = true;
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
    const mediaEls = iframeDoc.querySelectorAll("audio[data-start], video[data-start]");
    for (const iframeEl of mediaEls) {
      if (isRealmHtmlMediaElement(iframeEl)) this._adoptIframeMedia(iframeEl);
    }
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
    source?: HTMLMediaElement | null,
  ): ProxyEntry | null {
    if (this._entries.some((m) => m.el.src === src)) return null;

    const el = tag === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    el.src = src;
    el.load();
    el.muted = this._getMuted();
    const authorVolume = source ? readAuthorVolume(source) : 1;
    const mediaStart = source ? readMediaStart(source) : 0;
    const authorPlaybackRate = source ? readAuthorPlaybackRate(source) : 1;
    el.volume = clampVolume(authorVolume * this._userVolume);
    const effectivePlaybackRate =
      authorPlaybackRate * normalizePlaybackRate(this._getPlaybackRate());
    if (effectivePlaybackRate !== 1) el.playbackRate = effectivePlaybackRate;

    const entry: ProxyEntry = {
      el,
      start,
      duration,
      mediaStart,
      authorVolume,
      authorPlaybackRate,
      driftSamples: 0,
      source,
    };
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

    const timing = readClipTiming(iframeEl);
    const start = timing.start ?? 0;
    const duration = timing.duration ?? Number.POSITIVE_INFINITY;
    const tag = iframeEl.tagName === "VIDEO" ? ("video" as const) : ("audio" as const);

    const created = this._createEntry(src, tag, start, duration, iframeEl);

    // If already under parent ownership and playing, the new proxy must catch
    // up immediately — bypass the jitter-coalescing gate.
    if (created && this._audioOwner === "parent") {
      this.mirrorTime(this._getCurrentTime(), { force: true });
      if (!this._isPaused()) this._playEntryIfActive(created);
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
            isRealmHtmlMediaElement(target) &&
            target.matches("audio[data-start], video[data-start]") &&
            target.preload === "auto"
          ) {
            this._adoptIframeMedia(target);
          }
          continue;
        }

        for (const added of m.addedNodes) {
          if (!isRealmElement(added)) continue;
          const candidates: HTMLMediaElement[] = [];
          if (
            isRealmHtmlMediaElement(added) &&
            added.matches("audio[data-start], video[data-start]")
          ) {
            candidates.push(added);
          }
          const inside = added.querySelectorAll("audio[data-start], video[data-start]");
          for (const el of inside) {
            if (isRealmHtmlMediaElement(el)) candidates.push(el);
          }
          for (const el of candidates) this._adoptIframeMedia(el);
        }

        for (const removed of m.removedNodes) {
          if (!isRealmElement(removed)) continue;
          const dropped: HTMLMediaElement[] = [];
          if (
            isRealmHtmlMediaElement(removed) &&
            removed.matches("audio[data-start], video[data-start]")
          ) {
            dropped.push(removed);
          }
          const inside = removed.querySelectorAll("audio[data-start], video[data-start]");
          for (const el of inside) {
            if (isRealmHtmlMediaElement(el)) dropped.push(el);
          }
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
