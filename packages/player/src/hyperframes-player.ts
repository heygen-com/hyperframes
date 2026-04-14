import { createControls, SPEED_PRESETS, type ControlsCallbacks } from "./controls.js";
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
   * Parent-frame media elements for mobile playback.
   *
   * Mobile browsers block media.play() inside iframes when the user gesture
   * happened in the parent frame — postMessage doesn't transfer user activation
   * (per the User Activation v2 spec). We extract ALL media sources from the
   * iframe's timed elements (audio/video with data-start), play them in the
   * parent frame (where the gesture lives), and disable the iframe copies.
   */
  private _parentMedia: Array<{
    el: HTMLMediaElement;
    start: number;
    duration: number;
  }> = [];

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
    this._playParentMedia();
    this._sendControl("play");
    this._paused = false;
    this.controlsApi?.updatePlaying(true);
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    this._pauseParentMedia();
    this._sendControl("pause");
    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this.dispatchEvent(new Event("pause"));
  }

  seek(timeInSeconds: number) {
    const frame = Math.round(timeInSeconds * DEFAULT_FPS);
    this._sendControl("seek", { frame });
    this._currentTime = timeInSeconds;

    // Sync parent media positions (accounting for each element's start offset)
    for (const m of this._parentMedia) {
      const relTime = timeInSeconds - m.start;
      if (relTime >= 0 && relTime < m.duration) {
        m.el.currentTime = relTime;
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

      // Sync parent media on runtime play/pause transitions (e.g. browser
      // throttling, visibility change, or scrubber interaction in the iframe).
      if (wasPlaying && this._paused) {
        this._pauseParentMedia();
      } else if (!wasPlaying && !this._paused) {
        this._playParentMedia();
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
        this._pauseParentMedia();
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

        // Auto-inject runtime if GSAP timelines exist but no runtime bridge
        if (!hasRuntime && hasTimelines && !this._runtimeInjected && attempts >= 5) {
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
      if (m.el.src) m.el.play().catch(() => {});
    }
  }

  private _pauseParentMedia() {
    for (const m of this._parentMedia) m.el.pause();
  }

  /** Create a parent-frame media element, configure it, and start preloading. */
  private _createParentMedia(src: string, tag: "audio" | "video", start: number, duration: number) {
    // Deduplicate — browsers normalize URLs so we compare on the element after assignment
    if (this._parentMedia.some((m) => m.el.src === src)) return;

    const el = tag === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    el.src = src;
    el.load();
    el.muted = this.muted;
    if (this.playbackRate !== 1) el.playbackRate = this.playbackRate;

    this._parentMedia.push({ el, start, duration });
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
   * Extract ALL timed media (audio/video with data-start) from the iframe's
   * DOM and create parent-frame copies. Disables the iframe originals so the
   * runtime doesn't try to play them (which would fail on mobile and cause
   * double playback on desktop).
   *
   * If `audio-src` was already set, this just disables the iframe media.
   */
  private _setupParentMedia() {
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) return;

      // Find all timed media — matches the runtime's media.ts selector
      const mediaEls = doc.querySelectorAll<HTMLMediaElement>(
        "audio[data-start], video[data-start]",
      );

      for (const iframeEl of mediaEls) {
        const src = iframeEl.getAttribute("src") || iframeEl.querySelector("source")?.src;
        if (!src) continue;

        const start = parseFloat(iframeEl.getAttribute("data-start") || "0");
        const duration = parseFloat(iframeEl.getAttribute("data-duration") || "Infinity");
        const tag = iframeEl.tagName === "VIDEO" ? ("video" as const) : ("audio" as const);

        this._createParentMedia(src, tag, start, duration);

        // Disable the iframe element so the runtime ignores it
        iframeEl.removeAttribute("src");
        iframeEl.removeAttribute("data-start");
        iframeEl.removeAttribute("data-duration");
        iframeEl.querySelectorAll("source").forEach((s) => s.remove());
      }
    } catch {
      // Cross-origin iframe — can't access DOM, fall back to iframe media
    }
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
