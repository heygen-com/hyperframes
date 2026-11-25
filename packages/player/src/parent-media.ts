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
import { isInClipWindow } from "@hyperframes/core/runtime/clip-window";
import { readClipTiming } from "@hyperframes/core/composition-contract";
import { readLinkTiming } from "@hyperframes/core/media-link";
import { wrapLoopedSourceTime } from "@hyperframes/core/media-timing";
import {
  mediaFileOf,
  PARENT_COPY_ATTRIBUTES,
  parentCopyKey,
  parentCopyOf,
  type ParentCopy,
} from "@hyperframes/core/audible-video";
import { mediaElementTime, startsSoundOnlyInsideATap } from "@hyperframes/core/runtime/media-clock";
import {
  MEDIA_SYNC_TOLERANCE_SECONDS,
  forgetSteering,
  steerMedia,
} from "@hyperframes/core/runtime/media-steer";

/** An offset that moved less than this since the last sample is not growing: the element is not stalled. */
const SETTLED_OFFSET_DELTA_SECONDS = 0.004;

/**
 * How far ahead of its window a paused proxy is positioned at its media start, so the cut
 * only has to `play()`: a seek into unbuffered media lands about 80 ms late.
 */
const PRESEEK_SECONDS = 1.5;

const HAVE_FUTURE_DATA = 3;

export interface ProxyEntry {
  el: HTMLMediaElement;
  start: number;
  duration: number;
  /** Where in the file the clip begins (`data-media-start`); the proxy plays `t - start + mediaStart`. */
  mediaStart: number;
  /**
   * The iframe media element this proxy mirrors, when adopted from the DOM.
   * Its `data-start`/`data-duration` are re-read each tick so live timeline
   * edits (trim/move) bound the proxy correctly. Null for URL-driven proxies.
   */
  source?: HTMLMediaElement | null;
  /** The offset behind the timeline (+) at the last drift sample; steering is only trusted when it stopped growing. */
  lastOffset?: number;
  /** Seconds a seek of this playing proxy takes to land (smoothed); a seek aims this far ahead so it lands on time. */
  seekLatency?: number;
  /** When the seek still landing was issued (ms); unset when none is pending. */
  seekIssuedAt?: number;
  /** The clip as the film named it (`parentCopyKey`), for a copy made from a sealed film's list. */
  listedKey?: string;
  /** Played from a decoded buffer by `ParentAudio`, so this element stays silent. */
  claimed?: boolean;
  mastered?: boolean;
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
  /** A sealed film's copies, keyed by the clip they play, from its runtime's list. */
  private _listed = new Map<string, ProxyEntry>();
  private _filmSilenced = false;

  private readonly _dispatchEvent: (event: Event) => void;
  private readonly _getMuted: () => boolean;
  private readonly _getVolume: () => number;
  private readonly _getPlaybackRate: () => number;
  private readonly _getCurrentTime: () => number;
  private readonly _isPaused: () => boolean;
  private readonly _setFrameMuted: (muted: boolean) => void;

  constructor(opts: {
    dispatchEvent: (event: Event) => void;
    getMuted: () => boolean;
    getVolume: () => number;
    getPlaybackRate: () => number;
    getCurrentTime: () => number;
    isPaused: () => boolean;
    /** Silences the film's own media while a copy plays it instead, and gives it back after. */
    setFrameMuted: (muted: boolean) => void;
  }) {
    this._dispatchEvent = opts.dispatchEvent;
    this._getMuted = opts.getMuted;
    this._getVolume = opts.getVolume;
    this._getPlaybackRate = opts.getPlaybackRate;
    this._getCurrentTime = opts.getCurrentTime;
    this._isPaused = opts.isPaused;
    this._setFrameMuted = opts.setFrameMuted;
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
    for (const m of this._entries) if (m !== this._urlAudioEntry) m.el.src = "";
    this._entries = this._urlAudioEntry ? [this._urlAudioEntry] : [];
    this._listed.clear();
    this._filmSilenced = false;
    if (this._urlAudioSrc && !this._urlAudioEntry)
      this._urlAudioEntry = this._createEntry(urlAudio(this._urlAudioSrc));
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
    this._listed.clear();
    this._filmSilenced = false;
    this._urlAudioEntry = null;
    this._urlAudioSrc = null;
    this._audioOwner = "runtime";
    this._playbackErrorPosted = false;
  }

  updateMuted(muted: boolean): void {
    for (const m of this._entries) if (!m.claimed) m.el.muted = muted;
  }

  updateVolume(volume: number): void {
    for (const m of this._entries) m.el.volume = volume;
  }

  /** A sealed film's listed audio clips, which `ParentAudio` may play from decoded buffers. */
  listedAudio(): ProxyEntry[] {
    return [...this._listed.values()].filter((m) => m.el.tagName === "AUDIO");
  }

  updatePlaybackRate(rate: number): void {
    for (const m of this._entries) m.el.playbackRate = rate;
  }

  private _playEntry(m: ProxyEntry): void {
    if (!m.el.src || m.claimed) return;
    m.el.play().catch((err: unknown) => {
      this._syncFrameMute();
      this._reportPlaybackError(err);
    });
  }

  // Play only if the current playhead is inside the clip's (live) window, so
  // bulk starts (playAll / adopt) don't blip audio for clips outside their
  // window until the next mirrorTime tick gates them off.
  private _playEntryIfActive(m: ProxyEntry): void {
    this._refreshEntryBounds(m);
    if (!this._inWindow(m, this._getCurrentTime())) return;
    this._playEntry(m);
  }

  // Re-read the source clip's live timing so trims/moves bound the proxy
  // (adopt-time values go stale when the timeline is edited).
  private _refreshEntryBounds(m: ProxyEntry): void {
    if (!m.source?.isConnected) return;
    // Guard against a malformed (non-numeric) attribute parsing to NaN: an NaN
    // duration makes every window check pass, so the
    // gate never closes and the proxy plays past its clip end.
    const timing = readClipTiming(m.source);
    m.start = timing.start ?? 0;
    m.mediaStart = readLinkTiming(m.source).mediaStart;
    m.duration =
      timing.duration != null && timing.duration > 0 ? timing.duration : Number.POSITIVE_INFINITY;
  }

  // Pause the proxy outside its clip window; resume it on re-entry during
  // parent-owned playback. Returns whether the proxy is within the window.
  private _inWindow(m: ProxyEntry, timeSeconds: number): boolean {
    return isInClipWindow(timeSeconds, m.start, m.start + m.duration);
  }

  private _preseekUpcoming(m: ProxyEntry, timelineSeconds: number): void {
    const ahead = m.start - timelineSeconds;
    if (ahead <= 0 || ahead > PRESEEK_SECONDS || !m.el.paused) return;
    if (Math.abs(m.el.currentTime - m.mediaStart) > MEDIA_SYNC_TOLERANCE_SECONDS) {
      this._seekTo(m, m.mediaStart);
    }
  }

  // The one writer of a proxy's position: every seek lands here. A seek of a playing proxy aims ahead by
  // the time its seeks take to land: aimed at the playhead it lands behind it and the next tick seeks again.
  private _seekTo(m: ProxyEntry, mediaSeconds: number, playing = false): void {
    const lead = playing ? (m.seekLatency ?? 0) * this._getPlaybackRate() : 0;
    m.seekIssuedAt = playing ? performance.now() : undefined;
    m.el.currentTime = mediaElementTime(mediaSeconds + lead);
  }

  private _noteSeekLanded(m: ProxyEntry): void {
    if (m.seekIssuedAt === undefined) return;
    const landed = (performance.now() - m.seekIssuedAt) / 1000;
    m.seekLatency = m.seekLatency === undefined ? landed : (m.seekLatency + landed) / 2;
    m.seekIssuedAt = undefined;
  }

  // Back to the authored rate with no drift history: the proxy was seeked, paused or left its window.
  private _releaseSteering(m: ProxyEntry): void {
    forgetSteering(m.el);
    m.lastOffset = undefined;
    const rate = this._getPlaybackRate();
    if (m.el.playbackRate !== rate) m.el.playbackRate = rate;
  }

  private _mediaTime(m: ProxyEntry, timelineSeconds: number): number {
    const target = timelineSeconds - m.start + m.mediaStart;
    return m.el.loop && Number.isFinite(m.el.duration)
      ? wrapLoopedSourceTime(target, m.mediaStart, m.el.duration)
      : target;
  }

  private _gateEntryPlayback(m: ProxyEntry, timeSeconds: number): boolean {
    if (!this._inWindow(m, timeSeconds)) {
      if (!m.el.paused) m.el.pause();
      this._releaseSteering(m);
      return false;
    }
    if (this._audioOwner === "parent" && !this._isPaused() && m.el.paused) this._playEntry(m);
    return true;
  }

  playAll(): void {
    for (const m of this._entries) this._playEntryIfActive(m);
  }

  /** iOS lets an element start with sound later only if it was played inside a tap; do it for every copy. */
  primeAll(): void {
    if (!startsSoundOnlyInsideATap()) return;
    for (const m of this._entries) {
      if (!m.el.paused) continue;
      m.el.play().catch(() => {});
      m.el.pause();
    }
  }

  pauseAll(): void {
    for (const m of this._entries) m.el.pause();
  }

  stopAdoptedMedia(): void {
    for (const m of this._filmCopies()) m.el.pause();
  }

  seekAll(timeInSeconds: number): void {
    for (const m of this._entries) {
      // Re-read live bounds so a trim/move just before a paused scrub gates and
      // positions against the current clip window, not the adopt-time one.
      this._refreshEntryBounds(m);
      if (this._inWindow(m, timeInSeconds)) this._jumpTo(m, this._mediaTime(m, timeInSeconds));
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
      this._refreshEntryBounds(m);
      if (this._inWindow(m, timeInSeconds)) {
        this._jumpTo(m, this._mediaTime(m, timeInSeconds));
        this._playEntry(m);
      } else if (!m.el.paused) {
        m.el.pause();
      }
    }
  }

  /**
   * Mirror parent-proxy `currentTime` to the iframe timeline. Drift is steered by rate and
   * seeked only past the player's one drift policy (`steerMedia`). Pass `{ force: true }`
   * for alignment moments (ownership promotion, new proxy initialization) where a proxy off
   * the playhead must be seeked immediately.
   */
  mirrorTime(timelineSeconds: number, options?: { force?: boolean }): void {
    const force = options?.force === true;
    for (const m of this._entries) {
      this._refreshEntryBounds(m);
      this._preseekUpcoming(m, timelineSeconds);
      // A proxy entering its window that was not pre-positioned (a user seek) is seeked once, before it plays.
      const entering = m.el.paused;
      if (!this._gateEntryPlayback(m, timelineSeconds)) continue;
      const target = this._mediaTime(m, timelineSeconds);
      const offset = target - m.el.currentTime;
      if (force || entering) {
        if (Math.abs(offset) > MEDIA_SYNC_TOLERANCE_SECONDS) this._jumpTo(m, target);
        continue;
      }
      this._steer(m, target, offset);
    }
  }

  private _steer(m: ProxyEntry, target: number, offset: number): void {
    const settled =
      m.lastOffset !== undefined && Math.abs(offset - m.lastOffset) < SETTLED_OFFSET_DELTA_SECONDS;
    m.lastOffset = offset;
    const { rate, seek } = steerMedia(m.el, offset, this._getPlaybackRate(), settled, true);
    if (seek) this._jumpTo(m, target, true);
    else if (Math.abs(m.el.playbackRate - rate) > 1e-6) m.el.playbackRate = rate;
  }

  private _jumpTo(m: ProxyEntry, mediaSeconds: number, playing = false): void {
    this._seekTo(m, mediaSeconds, playing);
    this._releaseSteering(m);
  }

  /**
   * Take ownership of audible playback. Idempotent. The `onMirror` callback
   * is called with the current timeline time and `{ force: true }` so the
   * caller's mirror implementation runs (enabling test spies on the player
   * to fire). If omitted, `mirrorTime` is called directly.
   */
  promoteToParentProxy(onMirror?: (t: number, opts: { force: boolean }) => void): void {
    if (this._audioOwner === "parent") return;
    this._audioOwner = "parent";

    for (const m of [...this._entries]) this._repointToSource(m);

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
    const entry = this._urlTaken(audioSrc) ? null : this._createEntry(urlAudio(audioSrc));
    // Null when the composition already has a proxy for this URL: that one stays the
    // composition's, and a reset creates ours once that document's proxies are gone.
    this._urlAudioEntry = entry;
    this._urlAudioSrc = audioSrc;
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

  /** Copies for a sealed film, from its runtime's list: only files under the composition's own folder. */
  setupFromList(list: unknown, compositionUrl: string | null): void {
    const wanted = new Map<string, ParentCopy>();
    const refused: string[] = [];
    for (const copy of readCopies(list)) {
      const src = underComposition(copy.src, compositionUrl);
      if (src) wanted.set(JSON.stringify(copy), { ...copy, src });
      else refused.push(copy.src);
    }
    for (const [key, entry] of this._listed) {
      if (wanted.has(key)) continue;
      this._removeEntry(entry);
      this._listed.delete(key);
    }
    for (const [key, copy] of wanted) {
      if (this._listed.has(key)) continue;
      const entry = this._createEntry(copy, null, "anonymous");
      entry.listedKey = parentCopyKey(JSON.parse(key) as ParentCopy);
      this._listed.set(key, entry);
      this._copyAdded(entry);
    }
    if (refused.length === 0) return;
    const error = new Error("a sealed film's media outside the composition's folder is not copied");
    this._dispatchEvent(
      new CustomEvent("playbackerror", { detail: { source: "parent-proxy", error, refused } }),
    );
  }

  /** Create a parent-frame media element and start preloading it. */
  private _createEntry(
    copy: ParentCopy,
    source?: HTMLMediaElement | null,
    crossOrigin = source?.getAttribute("crossorigin") ?? null,
  ): ProxyEntry {
    const el = copy.kind === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    if (crossOrigin != null) el.setAttribute("crossorigin", crossOrigin);
    el.src = copy.src;
    el.loop = copy.loop === true;
    for (const name of PARENT_COPY_ATTRIBUTES) {
      const value = copy.attrs?.[name];
      if (value !== undefined) el.setAttribute(name, value);
    }
    el.load();
    el.muted = this._getMuted();
    el.volume = this._getVolume();
    const rate = this._getPlaybackRate();
    if (rate !== 1) el.playbackRate = rate;

    const entry: ProxyEntry = {
      el,
      start: copy.start,
      duration: copy.duration,
      mediaStart: copy.mediaStart,
      source,
      mastered: copy.mastered === true,
    };
    el.addEventListener("seeked", () => this._noteSeekLanded(entry));
    for (const change of ["playing", "waiting", "pause", "ended", "error"])
      el.addEventListener(change, () => this._syncFrameMute());
    this._entries.push(entry);
    return entry;
  }

  /** Every copy of the film's own media: all but the player's `audio-src` track. */
  private _filmCopies(): ProxyEntry[] {
    return this._entries.filter((m) => m !== this._urlAudioEntry);
  }

  // The film is silent exactly while a copy of its media is heard instead, read from each
  // copy's own state so the order its events arrive in cannot leave the film muted.
  private _syncFrameMute(): void {
    const heard =
      this._audioOwner === "parent" &&
      this._filmCopies().some(
        ({ el }) => !el.paused && !el.ended && !el.error && el.readyState >= HAVE_FUTURE_DATA,
      );
    if (heard === this._filmSilenced) return;
    this._filmSilenced = heard;
    const frameDoc = this._entries.find((m) => m.source)?.source?.ownerDocument;
    if (heard) {
      for (const el of frameDoc?.querySelectorAll("video, audio") ?? []) {
        if (isRealmHtmlMediaElement(el)) el.muted = true;
      }
    }
    this._setFrameMuted(heard);
  }

  // A copy made while the parent owns playback catches up at once, past the jitter gate.
  private _copyAdded(entry: ProxyEntry): void {
    if (this._audioOwner !== "parent") return;
    this.mirrorTime(this._getCurrentTime(), { force: true });
    if (!this._isPaused()) this._playEntryIfActive(entry);
  }

  private _adoptIframeMedia(iframeEl: HTMLMediaElement): void {
    if (this._entries.some((m) => m.source === iframeEl)) return;
    const copy = parentCopyOf(iframeEl);
    if (copy) this._copyAdded(this._createEntry(copy, iframeEl));
  }

  // The runtime re-points a clip (its preview copy, a new bound file). A proxy that is not
  // playing keeps its file until the parent takes over, so the copy is not fetched twice.
  private _followIframeMediaSrc(iframeEl: HTMLMediaElement): void {
    const entry = this._entries.find((m) => m.source === iframeEl);
    if (!entry) return this._adoptIframeMedia(iframeEl);
    if (this._audioOwner !== "parent" || !this._repointToSource(entry)) return;
    this.mirrorTime(this._getCurrentTime(), { force: true });
    if (!this._isPaused()) this._playEntryIfActive(entry);
  }

  /** Whether a clip's proxy already plays this file. A proxy's file is its clip's current one
   * (a clip that left the page owns none). */
  private _urlTaken(src: string): boolean {
    return this._entries.some((m) => {
      if (m.source && !m.source.isConnected) return false;
      return ((m.source && mediaFileOf(m.source)) || m.el.src) === src;
    });
  }

  private _repointToSource(entry: ProxyEntry): boolean {
    const src = entry.source ? mediaFileOf(entry.source) : null;
    if (!src || entry.el.src === src) return false;
    entry.el.src = src;
    entry.el.load();
    return true;
  }

  private _detachIframeMedia(iframeEl: HTMLMediaElement): void {
    const entry = this._entries.find((m) => m.source === iframeEl);
    if (entry) this._removeEntry(entry);
  }

  private _removeEntry(entry: ProxyEntry): void {
    entry.el.pause();
    entry.el.src = "";
    this._entries.splice(this._entries.indexOf(entry), 1);
    this._syncFrameMute();
  }

  private _observeDynamicMedia(doc: Document): void {
    this.teardownObserver();
    if (typeof MutationObserver === "undefined" || !doc.body) return;

    // fallow-ignore-next-line complexity
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "src") {
          const target = m.target;
          if (
            isRealmHtmlMediaElement(target) &&
            target.matches("audio[data-start], video[data-start]")
          ) {
            this._followIframeMediaSrc(target);
          }
          continue;
        }
        if (m.type === "attributes" && m.attributeName === "preload") {
          const target = m.target;
          if (
            isRealmHtmlMediaElement(target) &&
            target.matches("audio[data-start], video[data-start]")
          ) {
            if (target.preload === "auto") this._adoptIframeMedia(target);
            else this._detachIframeMedia(target);
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
      attributeFilter: ["preload", "src"],
    };

    const targets = selectMediaObserverTargets(doc);
    for (const target of targets) {
      obs.observe(target, observeOpts);
    }
    this._mediaObserver = obs;
  }
}

function urlAudio(src: string): ParentCopy {
  return { kind: "audio", src, start: 0, duration: Number.POSITIVE_INFINITY, mediaStart: 0 };
}

/** The well-formed clips of a list from the film; the frame is not trusted. */
function readCopies(list: unknown): ParentCopy[] {
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is ParentCopy => {
    if (typeof item !== "object" || item === null) return false;
    const c = item as Record<string, unknown>;
    return isCopyTiming(c) && isCopyExtras(c);
  });
}

function isCopyTiming(c: Record<string, unknown>): boolean {
  return (
    (c.kind === "audio" || c.kind === "video") &&
    typeof c.src === "string" &&
    Number.isFinite(c.start) &&
    typeof c.duration === "number" &&
    c.duration >= 0 &&
    Number.isFinite(c.mediaStart)
  );
}

const optional = (value: unknown, ok: (value: unknown) => boolean) =>
  value === undefined || ok(value);
const isBoolean = (value: unknown) => typeof value === "boolean";
const isLayer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

function isCopyExtras(c: Record<string, unknown>): boolean {
  return (
    optional(c.layer, isLayer) &&
    optional(c.loop, isBoolean) &&
    optional(c.mastered, isBoolean) &&
    optional(c.attrs, isCopyAttrs)
  );
}

const COPY_ATTR_NAMES = new Set<string>(PARENT_COPY_ATTRIBUTES);
const MAX_COPY_ATTR_LENGTH = 100_000;

function isCopyAttrs(attrs: unknown): boolean {
  if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) return false;
  return Object.entries(attrs).every(
    ([name, value]) =>
      COPY_ATTR_NAMES.has(name) &&
      typeof value === "string" &&
      value.length <= MAX_COPY_ATTR_LENGTH,
  );
}

/** The file's address on the composition's own origin when it is under its folder; otherwise null. */
function underComposition(src: string, compositionUrl: string | null): string | null {
  if (!compositionUrl) return null;
  try {
    const file = new URL(src);
    const base = new URL(compositionUrl);
    const web = /^https?:$/;
    if (!web.test(file.protocol) || !web.test(base.protocol)) return null;
    const folder = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
    if (file.origin !== base.origin || !file.pathname.startsWith(folder)) return null;
    const parts = file.pathname.slice(folder.length).split("/").map(decodeURIComponent);
    if (parts.some((part) => /[/\\]/.test(part) || part === "." || part === "..")) return null;
    const path = parts.map(encodeURIComponent).join("/");
    const query = file.search ? "?" + file.search.slice(1) : "";
    return base.origin + folder + path + query;
  } catch {
    return null;
  }
}
