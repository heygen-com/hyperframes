import { createControls, SPEED_PRESETS, type ControlsCallbacks } from "./controls.js";
import { shouldInjectRuntime } from "./shouldInjectRuntime.js";
import { PLAYER_STYLES } from "./styles.js";

const DEFAULT_FPS = 30;
const RUNTIME_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";

class HyperframesPlayer extends HTMLElement {
  static get observedAttributes() {
    return ["src", "width", "height", "controls", "muted", "poster", "playback-rate", "audio-src"];
  }

  private shadow: ShadowRoot;
  private container: HTMLDivElement;
  private iframe: HTMLIFrameElement;
  private posterEl: HTMLImageElement | null = null;
  private controlsApi: ReturnType<typeof createControls> | null = null;
  private resizeObserver: ResizeObserver;

  private _ready = false;
  private _duration = 0;
  private _currentTime = 0;
  private _paused = true;
  private _compositionWidth = 1920;
  private _compositionHeight = 1080;
  private _probeInterval: ReturnType<typeof setInterval> | null = null;
  private _lastUpdateMs = 0;

  /**
   * Parent-frame audio/video proxies, preloaded mirror copies of the iframe's
   * timed media. They exist as a fallback for environments that block iframe
   * `.play()` — mobile browsers require the user gesture to originate in the
   * same frame as the media element, and postMessage doesn't transfer user
   * activation (User Activation v2). The runtime inside the iframe signals
   * `media-autoplay-blocked` the first time a play() attempt rejects with
   * `NotAllowedError`; receiving that message flips `_audioOwner` to `parent`
   * and these proxies start driving audible output while the iframe keeps
   * advancing timed media silently for frame-accurate state.
   *
   * Preloading at iframe-load time (rather than lazily on promotion) keeps
   * the audible audio cut-in tight when the promotion fires mid-playback.
   */
  private _parentMedia: Array<{
    el: HTMLMediaElement;
    start: number;
    duration: number;
  }> = [];

  /**
   * Who owns audible playback right now.
   *
   * - `runtime` (default): the iframe's runtime drives timed media; parent
   *   proxies stay paused and silent. This is the correct path on desktop,
   *   in same-frame embeds, and anywhere the iframe has user activation.
   * - `parent`: parent-frame proxies drive audible output; the iframe keeps
   *   syncing timed media but at `muted = true` (orthogonal to author/user
   *   volume settings). Entered only in response to an actual autoplay
   *   rejection from the runtime — we don't guess device class.
   *
   * The transition is one-way per session; once autoplay is known to be
   * gated, there's no benefit to attempting the iframe path again.
   */
  private _audioOwner: "runtime" | "parent" = "runtime";

  /**
   * Watches the iframe document for sub-composition media added after
   * initial setup. Disconnected on iframe reload (fresh iframe = fresh
   * observer against the new document).
   */
  private _mediaObserver?: MutationObserver;

  /**
   * One-shot latch for `playbackerror`. Without it, under parent ownership
   * where the parent frame itself lacks activation, every paused→playing
   * transition in the iframe state loop would re-fire `play()` (and its
   * rejection) on each proxy — spamming host subscribers through a whole
   * playback session. Mirrors the `mediaAutoplayBlockedPosted` latch on the
   * runtime side. Cleared on `_onIframeLoad` alongside the owner reset, so
   * a fresh composition gets a fresh shot at surfacing the error.
   */
  private _playbackErrorPosted = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = PLAYER_STYLES;
    this.shadow.appendChild(style);

    this.container = document.createElement("div");
    this.container.className = "hfp-container";

    this.iframe = document.createElement("iframe");
    this.iframe.className = "hfp-iframe";
    this.iframe.sandbox.add("allow-scripts", "allow-same-origin");
    this.iframe.allow = "autoplay; fullscreen";
    this.iframe.referrerPolicy = "no-referrer";
    this.iframe.title = "HyperFrames Composition";

    this.container.appendChild(this.iframe);
    this.shadow.appendChild(this.container);

    // Clicking the bare player surface toggles play/pause.
    // Ignore shadow-DOM control interactions so overlay clicks don't double-handle.
    this.addEventListener("click", (event) => {
      if (this._isControlsClick(event)) return;
      if (this._paused) this.play();
      else this.pause();
    });

    this.resizeObserver = new ResizeObserver(() => this._updateScale());

    this._onMessage = this._onMessage.bind(this);
    this._onIframeLoad = this._onIframeLoad.bind(this);
  }

  connectedCallback() {
    this.resizeObserver.observe(this);
    window.addEventListener("message", this._onMessage);
    this.iframe.addEventListener("load", this._onIframeLoad);

    if (this.hasAttribute("controls")) this._setupControls();
    if (this.hasAttribute("poster")) this._setupPoster();
    if (this.hasAttribute("audio-src"))
      this._setupParentAudioFromUrl(this.getAttribute("audio-src")!);
    if (this.hasAttribute("src")) this.iframe.src = this.getAttribute("src")!;
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    window.removeEventListener("message", this._onMessage);
    this.iframe.removeEventListener("load", this._onIframeLoad);
    if (this._probeInterval) clearInterval(this._probeInterval);
    this._teardownMediaObserver();
    this.controlsApi?.destroy();
    for (const m of this._parentMedia) {
      m.el.pause();
      m.el.src = "";
    }
    this._parentMedia = [];
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    switch (name) {
      case "src":
        if (val) {
          this._ready = false;
          this.iframe.src = val;
        }
        break;
      case "width":
        this._compositionWidth = parseInt(val || "1920", 10);
        this._updateScale();
        break;
      case "height":
        this._compositionHeight = parseInt(val || "1080", 10);
        this._updateScale();
        break;
      case "controls":
        if (val !== null) this._setupControls();
        else {
          this.controlsApi?.destroy();
          this.controlsApi = null;
        }
        break;
      case "poster":
        this._setupPoster();
        break;
      case "playback-rate": {
        const rate = parseFloat(val || "1");
        for (const m of this._parentMedia) m.el.playbackRate = rate;
        this._sendControl("set-playback-rate", { playbackRate: rate });
        this.controlsApi?.updateSpeed(rate);
        this.dispatchEvent(new Event("ratechange"));
        break;
      }
      case "muted":
        for (const m of this._parentMedia) m.el.muted = val !== null;
        this._sendControl("set-muted", { muted: val !== null });
        break;
      case "audio-src":
        if (val) this._setupParentAudioFromUrl(val);
        break;
    }
  }

  // ── Public API ──

  /**
   * Access the inner `<iframe>` element rendering the composition.
   *
   * Use this when integrating the player with editors, recorders, or
   * timeline tools (e.g. `@hyperframes/studio`) that need to inspect
   * the composition's DOM or read its `__player` / `__timelines`
   * runtime objects.
   *
   * **Common pitfall:** the iframe lives inside the player's Shadow DOM.
   * Passing the `<hyperframes-player>` element itself to code that expects
   * an `<iframe>` will silently break — `.contentWindow` returns `null`.
   * Always extract `iframeElement` first:
   *
   * ```ts
   * // ❌ Wrong — element ref doesn't expose contentWindow
   * iframeRef.current = playerRef.current;
   *
   * // ✓ Right — bridge the actual iframe
   * iframeRef.current = playerRef.current.iframeElement;
   * ```
   */
  get iframeElement(): HTMLIFrameElement {
    return this.iframe;
  }

  play() {
    this._hidePoster();
    // Always drive the iframe runtime — it's the single source of timeline
    // truth regardless of who owns audible output. When we own audio, the
    // proxies join; when the runtime owns, they stay silent.
    this._sendControl("play");
    if (this._audioOwner === "parent") this._playParentMedia();
    this._paused = false;
    this.controlsApi?.updatePlaying(true);
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    this._sendControl("pause");
    if (this._audioOwner === "parent") this._pauseParentMedia();
    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this.dispatchEvent(new Event("pause"));
  }

  seek(timeInSeconds: number) {
    const frame = Math.round(timeInSeconds * DEFAULT_FPS);
    this._sendControl("seek", { frame });
    this._currentTime = timeInSeconds;

    // Mirror parent proxy currentTime only while parent owns audible output.
    // Under `runtime` ownership the proxies are paused and authoritative time
    // lives on the iframe — touching parent currentTime would just trigger
    // needless buffering if ownership later flips.
    if (this._audioOwner === "parent") {
      for (const m of this._parentMedia) {
        const relTime = timeInSeconds - m.start;
        if (relTime >= 0 && relTime < m.duration) m.el.currentTime = relTime;
      }
    }

    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this.controlsApi?.updateTime(this._currentTime, this._duration);
  }

  get currentTime() {
    return this._currentTime;
  }
  set currentTime(t: number) {
    this.seek(t);
  }

  get duration() {
    return this._duration;
  }
  get paused() {
    return this._paused;
  }
  get ready() {
    return this._ready;
  }

  get playbackRate() {
    return parseFloat(this.getAttribute("playback-rate") || "1");
  }
  set playbackRate(r: number) {
    this.setAttribute("playback-rate", String(r));
  }

  get muted() {
    return this.hasAttribute("muted");
  }
  set muted(m: boolean) {
    if (m) this.setAttribute("muted", "");
    else this.removeAttribute("muted");
  }

  get loop() {
    return this.hasAttribute("loop");
  }
  set loop(l: boolean) {
    if (l) this.setAttribute("loop", "");
    else this.removeAttribute("loop");
  }

  // ── Private ──

  private _sendControl(action: string, extra: Record<string, unknown> = {}) {
    try {
      this.iframe.contentWindow?.postMessage(
        { source: "hf-parent", type: "control", action, ...extra },
        "*",
      );
    } catch {
      /* cross-origin */
    }
  }

  private _isControlsClick(event: Event) {
    return event
      .composedPath()
      .some((target) => target instanceof HTMLElement && target.classList.contains("hfp-controls"));
  }

  private _onMessage(e: MessageEvent) {
    if (e.source !== this.iframe.contentWindow) return;
    const data = e.data;
    if (!data || data.source !== "hf-preview") return;

    if (data.type === "state") {
      this._currentTime = (data.frame ?? 0) / DEFAULT_FPS;
      const wasPlaying = !this._paused;
      this._paused = !data.isPlaying;

      // Under parent ownership the proxies are the audible output, so they
      // mirror the iframe's play/pause transitions (externally-driven pause
      // via `__player.pause()`, scrubber interactions, etc.) and their
      // currentTime is slaved to the iframe timeline. Under runtime ownership
      // the proxies stay paused and silent; nothing here should wake them.
      if (this._audioOwner === "parent") {
        if (wasPlaying && this._paused) {
          this._pauseParentMedia();
        } else if (!wasPlaying && !this._paused) {
          this._playParentMedia();
        }
        this._mirrorParentMediaTime(this._currentTime);
      }

      // Throttle UI updates and event dispatch to ~10fps to avoid excessive re-renders
      const now = performance.now();
      if (now - this._lastUpdateMs > 100 || this._paused !== wasPlaying) {
        this._lastUpdateMs = now;
        this.controlsApi?.updateTime(this._currentTime, this._duration);
        this.controlsApi?.updatePlaying(!this._paused);
        this.dispatchEvent(
          new CustomEvent("timeupdate", { detail: { currentTime: this._currentTime } }),
        );
      }

      if (this._currentTime >= this._duration && !this._paused) {
        if (this._audioOwner === "parent") this._pauseParentMedia();
        if (this.loop) {
          this.seek(0);
          this.play();
        } else {
          this._paused = true;
          this.controlsApi?.updatePlaying(false);
          this.dispatchEvent(new Event("ended"));
        }
      }
    }

    if (data.type === "media-autoplay-blocked") {
      this._promoteToParentProxy();
    }

    if (data.type === "timeline" && data.durationInFrames > 0) {
      // Ignore Infinity duration from runtime (caused by loop-inflated timelines without data-duration)
      // The player already has duration from the initial probe, so keep that.
      if (Number.isFinite(data.durationInFrames)) {
        this._duration = data.durationInFrames / DEFAULT_FPS;
        this.controlsApi?.updateTime(this._currentTime, this._duration);
      }
    }

    if (data.type === "stage-size" && data.width > 0 && data.height > 0) {
      this._compositionWidth = data.width;
      this._compositionHeight = data.height;
      this._updateScale();
    }
  }

  private _runtimeInjected = false;

  private _onIframeLoad() {
    let attempts = 0;
    this._runtimeInjected = false;
    // A fresh iframe means a fresh runtime — `mediaOutputMuted` and the
    // autoplay-blocked latch are both reset inside it. The web component's
    // `_audioOwner` must reset to match, otherwise a composition switch on
    // a previously-promoted player would leave the parent thinking it owns
    // audio against a runtime that's happily playing the iframe copy again
    // — briefly reintroducing the double-voice bug for one probe window.
    // The next `NotAllowedError` (if any) will re-promote.
    const wasPromoted = this._audioOwner === "parent";
    this._audioOwner = "runtime";
    this._playbackErrorPosted = false;
    this._pauseParentMedia();
    // The old iframe document is about to go away. Disconnect the
    // MutationObserver now so we don't hold a reference to it; a fresh
    // one will attach once the new document settles in `_setupParentMedia`.
    this._teardownMediaObserver();
    if (wasPromoted) {
      this.dispatchEvent(
        new CustomEvent("audioownershipchange", {
          detail: { owner: "runtime", reason: "iframe-reload" },
        }),
      );
    }
    if (this._probeInterval) clearInterval(this._probeInterval);

    this._probeInterval = setInterval(() => {
      attempts++;
      try {
        const win = this.iframe.contentWindow as Window & {
          __player?: { getDuration: () => number };
          __timelines?: Record<string, { duration: () => number }>;
          __hf?: unknown;
        };
        if (!win) return;

        // Check if the runtime bridge is active (__hf or __player from the runtime)
        const hasRuntime = !!(win.__hf || win.__player);
        const hasTimelines = !!(win.__timelines && Object.keys(win.__timelines).length > 0);
        const hasNestedCompositions =
          !!this.iframe.contentDocument?.querySelector("[data-composition-src]");

        if (
          shouldInjectRuntime({
            hasRuntime,
            hasTimelines,
            hasNestedCompositions,
            runtimeInjected: this._runtimeInjected,
            attempts,
          })
        ) {
          this._injectRuntime();
          return; // Wait for runtime to load and initialize
        }

        // Runtime was injected but hasn't loaded yet — keep waiting
        if (this._runtimeInjected && !hasRuntime) {
          return;
        }

        const getAdapter = () => {
          if (win.__player && typeof win.__player.getDuration === "function") return win.__player;
          if (win.__timelines) {
            const keys = Object.keys(win.__timelines);
            if (keys.length > 0) {
              // Resolve the root composition id from the DOM — the outermost
              // `[data-composition-id]` element is the master. Bundled previews
              // register the root composition alongside sub-compositions, and
              // without this lookup Object.keys() order would make a
              // sub-composition's duration hijack the overall video length.
              const rootId = this.iframe.contentDocument
                ?.querySelector("[data-composition-id]")
                ?.getAttribute("data-composition-id");
              const key = rootId && rootId in win.__timelines ? rootId : keys[keys.length - 1];
              const tl = win.__timelines[key];
              return { getDuration: () => tl.duration() };
            }
          }
          return null;
        };

        const adapter = getAdapter();
        if (adapter && adapter.getDuration() > 0) {
          clearInterval(this._probeInterval!);
          this._duration = adapter.getDuration();
          this._ready = true;
          this.controlsApi?.updateTime(0, this._duration);
          this.dispatchEvent(new CustomEvent("ready", { detail: { duration: this._duration } }));

          // Auto-detect dimensions from composition
          const doc = this.iframe.contentDocument;
          const root = doc?.querySelector("[data-composition-id]");
          if (root) {
            const w = parseInt(root.getAttribute("data-width") || "0", 10);
            const h = parseInt(root.getAttribute("data-height") || "0", 10);
            if (w > 0 && h > 0) {
              this._compositionWidth = w;
              this._compositionHeight = h;
              this._updateScale();
            }
          }

          this._setupParentMedia();

          if (this.hasAttribute("autoplay")) {
            this.play();
          }
          return;
        }
      } catch {
        /* cross-origin */
      }

      if (attempts >= 40) {
        clearInterval(this._probeInterval!);
        this.dispatchEvent(
          new CustomEvent("error", {
            detail: { message: "Composition timeline not found after 8s" },
          }),
        );
      }
    }, 200);
  }

  /** Inject the HyperFrames runtime into the iframe if not already present. */
  private _injectRuntime() {
    this._runtimeInjected = true;
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) return;
      const script = doc.createElement("script");
      script.src = RUNTIME_CDN_URL;
      script.onload = () => {
        // Runtime loaded — the probe interval will pick up __hf on next tick
      };
      script.onerror = () => {
        // CDN failed — the probe will continue and eventually timeout
      };
      (doc.head || doc.documentElement).appendChild(script);
    } catch {
      /* cross-origin — can't inject */
    }
  }

  private _updateScale() {
    const rect = this.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = Math.min(
      rect.width / this._compositionWidth,
      rect.height / this._compositionHeight,
    );
    this.iframe.style.width = `${this._compositionWidth}px`;
    this.iframe.style.height = `${this._compositionHeight}px`;
    this.iframe.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  private _setupControls() {
    if (this.controlsApi) return;
    const callbacks: ControlsCallbacks = {
      onPlay: () => this.play(),
      onPause: () => this.pause(),
      onSeek: (fraction) => this.seek(fraction * this._duration),
      onSpeedChange: (speed) => {
        this.playbackRate = speed;
      },
    };
    const presetsAttr = this.getAttribute("speed-presets");
    const speedPresets = presetsAttr
      ? presetsAttr
          .split(",")
          .map(Number)
          .filter((n) => !isNaN(n) && n > 0)
      : undefined;
    this.controlsApi = createControls(this.shadow, callbacks, { speedPresets });
  }

  private _setupPoster() {
    const url = this.getAttribute("poster");
    if (!url) {
      this.posterEl?.remove();
      this.posterEl = null;
      return;
    }
    if (!this.posterEl) {
      this.posterEl = document.createElement("img");
      this.posterEl.className = "hfp-poster";
      this.shadow.appendChild(this.posterEl);
    }
    this.posterEl.src = url;
  }

  private _playParentMedia() {
    for (const m of this._parentMedia) {
      if (!m.el.src) continue;
      // Under parent ownership the proxy is the only audible pipeline. If
      // its `play()` rejects (rare — parent also lacks activation in some
      // programmatic embed flows), swallowing silently leaves the viewer
      // staring at motion with no audio and no signal. Surface it as a
      // `playbackerror` event — but only once per parent-ownership session;
      // see `_playbackErrorPosted` for why.
      m.el.play().catch((err: unknown) => this._reportPlaybackError(err));
    }
  }

  private _reportPlaybackError(err: unknown) {
    if (this._playbackErrorPosted) return;
    this._playbackErrorPosted = true;
    this.dispatchEvent(
      new CustomEvent("playbackerror", { detail: { source: "parent-proxy", error: err } }),
    );
  }

  private _pauseParentMedia() {
    for (const m of this._parentMedia) m.el.pause();
  }

  /**
   * Drag parent-proxy `currentTime` onto the iframe's timeline. Called on
   * every runtime state message under parent ownership. Threshold is 50 ms
   * — ITU-R BT.1359 puts A/V offset perceptibility at roughly ±45 ms, so
   * anything looser risks audible lip-sync drift on talking-head content
   * (a core use case). The re-seek cost at this tightness is a handful of
   * extra `currentTime` writes per second; the media element's own buffer
   * smooths them out without visible rebuffer on the mirror path.
   */
  private static readonly MIRROR_DRIFT_THRESHOLD_SECONDS = 0.05;

  private _mirrorParentMediaTime(timelineSeconds: number) {
    for (const m of this._parentMedia) {
      const relTime = timelineSeconds - m.start;
      if (relTime < 0 || relTime >= m.duration) continue;
      if (Math.abs(m.el.currentTime - relTime) > HyperframesPlayer.MIRROR_DRIFT_THRESHOLD_SECONDS) {
        m.el.currentTime = relTime;
      }
    }
  }

  /**
   * Take ownership of audible playback. Fired in response to the runtime's
   * `media-autoplay-blocked` signal — the iframe has lost the autoplay lottery
   * and will never produce audio without a fresh gesture inside itself.
   *
   * Effects, in order:
   *   1. Ask the runtime to mute its own media output via the bridge. The
   *      runtime then keeps advancing timed media for frame-accurate state
   *      but produces no sound of its own, freeing us to be the single
   *      audible source without racing a volume-reassert loop.
   *   2. Align every parent proxy's currentTime to the iframe's timeline so
   *      the cut-over is imperceptible.
   *   3. If the player is currently playing, start the proxies.
   *
   * Idempotent: repeat calls are a no-op.
   */
  private _promoteToParentProxy() {
    if (this._audioOwner === "parent") return;
    this._audioOwner = "parent";
    // `_sendControl` is async — the iframe won't see the mute for ~one
    // message-loop tick. In that narrow window the runtime's next
    // `syncRuntimeMedia` pass may still try `el.play()` on the iframe
    // copy; we rely on the autoplay gate (which got us here in the first
    // place) to keep rejecting until our mute lands. This is defensible
    // precisely because the scenario that triggered promotion is
    // "autoplay blocked" — the iframe can't make noise on its own.
    this._sendControl("set-media-output-muted", { muted: true });
    this._mirrorParentMediaTime(this._currentTime);
    if (!this._paused) this._playParentMedia();
    this.dispatchEvent(
      new CustomEvent("audioownershipchange", {
        detail: { owner: "parent", reason: "autoplay-blocked" },
      }),
    );
  }

  /**
   * Create a parent-frame media element, configure it, and start preloading.
   * Returns the newly-created proxy entry, or `null` if one already exists for
   * this src (dedup) — callers that need to act on the new element should
   * branch on the return value rather than inferring via `_parentMedia.length`.
   */
  private _createParentMedia(
    src: string,
    tag: "audio" | "video",
    start: number,
    duration: number,
  ): { el: HTMLMediaElement; start: number; duration: number } | null {
    // Deduplicate — browsers normalize URLs so we compare on the element after assignment
    if (this._parentMedia.some((m) => m.el.src === src)) return null;

    const el = tag === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    el.src = src;
    el.load();
    el.muted = this.muted;
    if (this.playbackRate !== 1) el.playbackRate = this.playbackRate;

    const entry = { el, start, duration };
    this._parentMedia.push(entry);
    return entry;
  }

  /**
   * Set up a single parent-frame audio from an explicit URL (via `audio-src`).
   * Convenience for the common single-narration case — starts preloading
   * immediately without waiting for the iframe to load.
   */
  private _setupParentAudioFromUrl(audioSrc: string) {
    this._createParentMedia(audioSrc, "audio", 0, Infinity);
  }

  /**
   * Mirror every timed iframe media element (`audio[data-start]`,
   * `video[data-start]`) into a parent-frame proxy. The proxies preload at
   * iframe-ready time so the cut-over to parent ownership — should the
   * runtime's autoplay attempt later reject — is instantaneous.
   *
   * Under runtime ownership (the default) these proxies stay paused and
   * inert; the iframe is the audible source. Ownership flips only in
   * response to a real `media-autoplay-blocked` message from the runtime.
   *
   * Also installs a MutationObserver so that media added to the iframe
   * *after* the initial scan (sub-composition activation is the common
   * case) gets a proxy on the fly. Without this, under parent ownership
   * late-added `<audio data-start>` would be silenced by the runtime
   * (`outputMuted` sticks per-tick) but have no parent-frame counterpart
   * to play — a silent hole in the audio track.
   */
  private _setupParentMedia() {
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) return;

      // Find all timed media — matches the runtime's media.ts selector
      const mediaEls = doc.querySelectorAll<HTMLMediaElement>(
        "audio[data-start], video[data-start]",
      );
      for (const iframeEl of mediaEls) this._adoptIframeMedia(iframeEl);

      this._observeDynamicMedia(doc);
    } catch {
      // Cross-origin iframe — can't access DOM, fall back to iframe media
    }
  }

  /**
   * Create a parent-frame proxy mirroring a single iframe media element.
   * Extracted so both the initial scan and the MutationObserver path use
   * identical URL-resolution and attribute parsing.
   */
  private _adoptIframeMedia(iframeEl: HTMLMediaElement): void {
    const rawSrc =
      iframeEl.getAttribute("src") || iframeEl.querySelector("source")?.getAttribute("src");
    if (!rawSrc) return;

    // Resolve against the iframe's baseURI. The parent-frame <audio>/<video>
    // we create next lives in the host document, whose base URL differs from
    // the iframe's — without this, a relative src like "assets/narration.wav"
    // would resolve against the studio root and 404.
    const src = new URL(rawSrc, iframeEl.ownerDocument.baseURI).href;

    const start = parseFloat(iframeEl.getAttribute("data-start") || "0");
    const duration = parseFloat(iframeEl.getAttribute("data-duration") || "Infinity");
    const tag = iframeEl.tagName === "VIDEO" ? ("video" as const) : ("audio" as const);

    const created = this._createParentMedia(src, tag, start, duration);
    // Iframe originals stay untouched — the runtime's `syncRuntimeMedia`
    // queries `audio[data-start]` for state and needs them addressable.
    // Their audible output is gated later by `set-media-output-muted` when
    // (and only when) parent ownership is promoted.

    // If we're already under parent ownership and the player is playing,
    // the new proxy needs to pick up where the timeline currently is and
    // start producing audio right away — otherwise it sits silent through
    // the next several hundred ms until the next runtime state message.
    if (created && this._audioOwner === "parent") {
      this._mirrorParentMediaTime(this._currentTime);
      if (!this._paused && created.el.src) {
        created.el.play().catch((err: unknown) => this._reportPlaybackError(err));
      }
    }
  }

  /**
   * Watch the iframe document for subtree additions of timed media so
   * sub-composition activation (late-attached `<audio data-start>`) grows
   * the parent-proxy set automatically. Disconnected on iframe reload via
   * `_teardownMediaObserver`.
   */
  private _observeDynamicMedia(doc: Document): void {
    this._teardownMediaObserver();
    if (typeof MutationObserver === "undefined" || !doc.body) return;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (!(added instanceof Element)) continue;
          // Handle both the node itself and any timed media nested inside
          // (sub-compositions typically inject a fragment whose root is a
          // `<div data-composition-id=...>` with `<audio>` children).
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
          // Symmetric detach: when a sub-composition unmounts, the iframe
          // media it owned is gone but our parent proxies would otherwise
          // linger — accumulating host-document <audio> elements and, under
          // parent ownership, still being played by `_playParentMedia` as
          // orphans. Match by resolved URL (same resolution as adoption).
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
    obs.observe(doc.body, { childList: true, subtree: true });
    this._mediaObserver = obs;
  }

  private _teardownMediaObserver(): void {
    this._mediaObserver?.disconnect();
    this._mediaObserver = undefined;
  }

  /**
   * Inverse of `_adoptIframeMedia`: drop the parent proxy mirroring a removed
   * iframe media element. Resolves the src identically so matching is exact,
   * then pauses, clears the src (frees the decoder), and splices it out.
   */
  private _detachIframeMedia(iframeEl: HTMLMediaElement): void {
    const rawSrc =
      iframeEl.getAttribute("src") || iframeEl.querySelector("source")?.getAttribute("src");
    if (!rawSrc) return;
    const src = new URL(rawSrc, iframeEl.ownerDocument.baseURI).href;
    const idx = this._parentMedia.findIndex((m) => m.el.src === src);
    if (idx === -1) return;
    const entry = this._parentMedia[idx];
    entry.el.pause();
    entry.el.src = "";
    this._parentMedia.splice(idx, 1);
  }

  private _hidePoster() {
    this.posterEl?.remove();
    this.posterEl = null;
  }
}

if (!customElements.get("hyperframes-player")) {
  customElements.define("hyperframes-player", HyperframesPlayer);
}

export { HyperframesPlayer };
export { formatTime, formatSpeed, SPEED_PRESETS } from "./controls.js";
export type { ControlsCallbacks, ControlsOptions } from "./controls.js";
