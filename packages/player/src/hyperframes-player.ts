import { CompositionProbe, type ProbeResult } from "./composition-probe.js";
import { isControlsClick, setupControls, setupPoster } from "./controls-setup.js";
import { adoptShadowStyles, createCompositionIframe, scaleIframeToFit } from "./iframe-dom.js";
import { DirectTimelineClock } from "./direct-timeline-clock.js";
import { ParentMediaManager } from "./parent-media.js";
import { handleRuntimeMessage } from "./runtime-message-handler.js";
import {
  SHADER_CAPTURE_SCALE_ATTR,
  SHADER_LOADING_ATTR,
  type ShaderLoadingMode,
  getShaderCaptureScaleFromElement,
  getShaderModeFromElement,
  prepareSrcForElement,
  prepareSrcdocForElement,
} from "./shader-options.js";
import { createShaderLoader } from "./shader-loader-element.js";
import { ShaderLoaderState } from "./shader-loader-state.js";
import { PLAYER_STYLES } from "./styles.js";
import { type DirectTimelineAdapter } from "./timeline-adapters.js";

// Playback-rate bounds mirror the runtime clamp in
// packages/core/src/runtime/init.ts (applyPlaybackRate) and media.ts so the
// player accepts the same range as the in-iframe runtime: an out-of-range rate
// would otherwise drive the parent-proxied <audio> outside the bounds the
// timeline itself respects. Clamping here also shields the native
// HTMLMediaElement.playbackRate setter, which throws for extreme values in
// production browsers.
const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 5;

function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate));
}

class HyperframesPlayer extends HTMLElement {
  static get observedAttributes() {
    return [
      "src",
      "srcdoc",
      "width",
      "height",
      "controls",
      "muted",
      "audio-locked",
      "volume",
      "poster",
      "playback-rate",
      "audio-src",
      SHADER_CAPTURE_SCALE_ATTR,
      SHADER_LOADING_ATTR,
    ];
  }

  private shadow: ShadowRoot;
  private container: HTMLDivElement;
  private iframe: HTMLIFrameElement;
  private posterEl: HTMLImageElement | null = null;
  private controlsApi: ReturnType<typeof setupControls> | null = null;
  private resizeObserver: ResizeObserver;
  private shaderLoader: ShaderLoaderState;
  private probe: CompositionProbe;

  private _ready = false;
  private _currentTime = 0;
  private _duration = 0;
  private _paused = true;
  private _lastUpdateMs = 0;
  private _volume = 1;
  private _compositionWidth = 1920;
  private _compositionHeight = 1080;
  private _directTimelineAdapter: DirectTimelineAdapter | null = null;
  private _directTimelineClock: DirectTimelineClock;
  private _parentTickRaf: number | null = null;
  private _media: ParentMediaManager;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });

    adoptShadowStyles(this.shadow, PLAYER_STYLES);
    ({ container: this.container, iframe: this.iframe } = createCompositionIframe());
    this.shadow.appendChild(this.container);

    const loaderElements = createShaderLoader();
    this.shadow.appendChild(loaderElements.root);
    this.shaderLoader = new ShaderLoaderState(loaderElements);

    this._media = new ParentMediaManager({
      dispatchEvent: (e) => this.dispatchEvent(e),
      getMuted: () => this.muted,
      getVolume: () => this._volume,
      getPlaybackRate: () => this.playbackRate,
      getCurrentTime: () => this._currentTime,
      isPaused: () => this._paused,
    });

    this._directTimelineClock = new DirectTimelineClock({
      onTimeUpdate: (currentTime, duration) => {
        this._currentTime = currentTime;
        this.controlsApi?.updateTime(currentTime, duration);
        this.dispatchEvent(new CustomEvent("timeupdate", { detail: { currentTime } }));
      },
      getLoop: () => this.loop,
      restart: () => {
        this.seek(0);
        this.play();
      },
      onPaused: () => {
        if (this._media.audioOwner === "parent") this._media.pauseAll();
        this._paused = true;
        this.controlsApi?.updatePlaying(false);
        this.dispatchEvent(new Event("ended"));
      },
      onEnded: () => this.loop,
    });

    this.probe = new CompositionProbe(this.iframe, {
      onReady: (result) => this._onProbeReady(result),
      onError: (message) => this.dispatchEvent(new CustomEvent("error", { detail: { message } })),
    });

    this.addEventListener("click", (event) => {
      if (isControlsClick(event)) return;
      if (this._paused) this.play();
      else this.pause();
    });

    this.resizeObserver = new ResizeObserver(() => this._rescale());
    this._onMessage = this._onMessage.bind(this);
    this._onIframeLoad = this._onIframeLoad.bind(this);
  }

  connectedCallback() {
    this.resizeObserver.observe(this);
    window.addEventListener("message", this._onMessage);
    this.iframe.addEventListener("load", this._onIframeLoad);
    if (this.hasAttribute("controls")) this._setupControls();
    if (this.hasAttribute("poster"))
      this.posterEl = setupPoster(this.shadow, this.getAttribute("poster"), this.posterEl);
    if (this.hasAttribute("audio-src")) this._media.setupFromUrl(this.getAttribute("audio-src")!);
    if (this.hasAttribute("srcdoc"))
      this.iframe.srcdoc = prepareSrcdocForElement(this, this.getAttribute("srcdoc")!);
    if (this.hasAttribute("src"))
      this.iframe.src = prepareSrcForElement(this, this.getAttribute("src")!);

    // Host-environment audio lock: when the embedding host (e.g. Claude
    // desktop) drops the `audio-locked` attribute, attributeChangedCallback
    // never fires for it, so apply the lock here based on UA detection.
    if (!this.hasAttribute("audio-locked") && this._isLockedHostEnvironment()) {
      this._applyAudioLock(true);
    }
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    window.removeEventListener("message", this._onMessage);
    this.iframe.removeEventListener("load", this._onIframeLoad);
    this.probe.stop();
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    this._directTimelineAdapter = null;
    this.shaderLoader.destroy();
    this._media.destroy();
    this.controlsApi?.destroy();
  }

  // fallow-ignore-next-line complexity
  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    switch (name) {
      case "src":
        if (val) {
          this._ready = false;
          this.iframe.src = prepareSrcForElement(this, val);
        }
        break;
      case "srcdoc":
        this._ready = false;
        if (val !== null) this.iframe.srcdoc = prepareSrcdocForElement(this, val);
        else this.iframe.removeAttribute("srcdoc");
        break;
      case "width":
        this._compositionWidth = parseInt(val || "1920", 10);
        this._rescale();
        break;
      case "height":
        this._compositionHeight = parseInt(val || "1080", 10);
        this._rescale();
        break;
      case "controls":
        if (val !== null) this._setupControls();
        else {
          this.controlsApi?.destroy();
          this.controlsApi = null;
        }
        break;
      case "poster":
        this.posterEl = setupPoster(this.shadow, val, this.posterEl);
        break;
      case "playback-rate": {
        const rate = clampPlaybackRate(parseFloat(val || "1"));
        this._media.updatePlaybackRate(rate);
        this._sendControl("set-playback-rate", { playbackRate: rate });
        this._directTimelineAdapter?.timeScale?.(rate);
        this.controlsApi?.updateSpeed(rate);
        this.dispatchEvent(new Event("ratechange"));
        break;
      }
      case "muted":
        this._handleMutedChange(val);
        break;
      case "audio-locked":
        this._applyAudioLock(val !== null);
        break;
      case "volume": {
        const v = Math.max(0, Math.min(1, parseFloat(val || "1")));
        this._volume = v;
        this._media.updateVolume(v);
        this._sendControl("set-volume", { volume: v });
        this.controlsApi?.updateVolume(v);
        this.dispatchEvent(new Event("volumechange"));
        break;
      }
      case "audio-src":
        if (val) this._media.setupFromUrl(val);
        else this._media.teardownUrlAudio();
        break;
      case SHADER_CAPTURE_SCALE_ATTR:
      case SHADER_LOADING_ATTR:
        this._reloadShaderOptions();
        break;
    }
  }

  /**
   * The inner `<iframe>` rendering the composition. Use this when integrating
   * with tools that need `contentWindow` — `.contentWindow` on the
   * `<hyperframes-player>` element itself returns `null` (Shadow DOM).
   */
  get iframeElement(): HTMLIFrameElement {
    return this.iframe;
  }

  play() {
    this.posterEl?.remove();
    this.posterEl = null;
    if (this._duration > 0 && this._currentTime >= this._duration) this.seek(0);
    // Must be set before _startParentTickClock so the RAF loop's `_paused`
    // check doesn't immediately self-terminate on the first callback.
    this._paused = false;
    const directTimelineStarted = this._tryDirectTimelinePlay();
    if (!directTimelineStarted) {
      this._sendControl("play");
      // Only start the parent tick clock once the composition is ready and
      // confirmed on the runtime bridge path (not the direct-timeline path).
      // Guards against firing ticks into an uninitialized iframe when play()
      // is called before the probe has resolved.
      if (this._ready && !this._directTimelineAdapter) {
        this._startParentTickClock();
      }
    }
    if (this._media.audioOwner === "parent") this._media.playAll();
    this.controlsApi?.updatePlaying(true);
    this.dispatchEvent(new Event("play"));
    if (directTimelineStarted && this._directTimelineAdapter) {
      this._directTimelineClock.start(
        this._directTimelineAdapter,
        () => this._currentTime,
        () => this._duration,
        () => this._paused,
      );
    }
  }

  pause() {
    if (!this._tryDirectTimelinePause()) this._sendControl("pause");
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    if (this._media.audioOwner === "parent") this._media.pauseAll();
    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this.dispatchEvent(new Event("pause"));
  }

  seek(timeInSeconds: number) {
    if (!this._trySyncSeek(timeInSeconds) && !this._tryDirectTimelineSeek(timeInSeconds)) {
      this._sendControl("seek", { frame: Math.round(timeInSeconds * 30) });
    }
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    this._currentTime = timeInSeconds;
    if (this._media.audioOwner === "parent") {
      // Pause BEFORE seek: leaving the proxy playing turns the next
      // `mirrorTime` drift-correction tick into a perpetual seek→play→drift→seek
      // stutter loop, where ~80ms of audio plays past the (now frozen) timeline,
      // then mirrorTime yanks `currentTime` back to match it. Symmetric with
      // `pause()` below.
      this._media.pauseAll();
      this._media.seekAll(timeInSeconds);
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
    return clampPlaybackRate(parseFloat(this.getAttribute("playback-rate") || "1"));
  }
  set playbackRate(r: number) {
    this.setAttribute("playback-rate", String(clampPlaybackRate(r)));
  }

  get shaderCaptureScale() {
    return getShaderCaptureScaleFromElement(this);
  }
  set shaderCaptureScale(scale: number) {
    this.setAttribute(SHADER_CAPTURE_SCALE_ATTR, String(scale));
  }

  get shaderLoading() {
    return getShaderModeFromElement(this);
  }
  set shaderLoading(mode: ShaderLoadingMode) {
    if (mode === "composition") this.removeAttribute(SHADER_LOADING_ATTR);
    else this.setAttribute(SHADER_LOADING_ATTR, mode);
  }

  get muted() {
    return this.hasAttribute("muted");
  }
  set muted(m: boolean) {
    if (m) this.setAttribute("muted", "");
    else this.removeAttribute("muted");
  }

  get audioLocked() {
    return this.hasAttribute("audio-locked");
  }
  set audioLocked(locked: boolean) {
    if (locked) this.setAttribute("audio-locked", "");
    else this.removeAttribute("audio-locked");
  }

  /**
   * Host renderers that strip unknown custom-element attributes before they
   * reach the DOM (observed on the Claude desktop Electron client) can defeat
   * `audio-locked` even when the host *intends* to lock audio. When we detect
   * such an environment, self-impose the same restriction the attribute would
   * apply. Web (browser) hosts preserve the attribute and don't need this.
   */
  private _isLockedHostEnvironment(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    // Claude desktop ships as an Electron app with a "Claude/<version>" UA token.
    return /\bClaude\/\d/.test(ua) && /\bElectron\b/.test(ua);
  }

  /** True when audio playback must be locked: attribute OR host fallback. */
  private _isAudioLocked(): boolean {
    return this.hasAttribute("audio-locked") || this._isLockedHostEnvironment();
  }

  /** Apply a change to the `muted` attribute: re-assert under an audio lock,
   *  else mute/unmute the media, sync the controls, and fire `volumechange`. */
  private _handleMutedChange(val: string | null): void {
    // While audio is locked, ignore any attempt to clear `muted` (host control,
    // stray script, raw `removeAttribute`) and re-assert it. The re-set fires
    // this callback again with val="" (not null) so it mutes normally — no loop.
    if (val === null && this._isAudioLocked()) {
      this.setAttribute("muted", "");
      return;
    }
    this._media.updateMuted(val !== null);
    this._sendControl("set-muted", { muted: val !== null });
    this.controlsApi?.updateMuted(val !== null);
    this.dispatchEvent(new Event("volumechange"));
  }

  /**
   * Host-mandated silent playback (e.g. embedded in a chat host): force mute
   * and hide the volume controls so the viewer cannot turn sound on. Unlocking
   * only unhides the controls — it does not auto-unmute; callers manage `muted`
   * explicitly after unlocking.
   */
  private _applyAudioLock(locked: boolean): void {
    if (locked) this.muted = true;
    this.controlsApi?.setVolumeControlsHidden(locked);
  }

  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    this.setAttribute("volume", String(Math.max(0, Math.min(1, v))));
  }

  get loop() {
    return this.hasAttribute("loop");
  }
  set loop(l: boolean) {
    if (l) this.setAttribute("loop", "");
    else this.removeAttribute("loop");
  }

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

  /**
   * Replay current bridge state to the iframe runtime. Triggered when the
   * runtime announces `{type: "ready"}` — repairs the race where the parent
   * posts control messages before the iframe's bridge listener is installed
   * (warm-cache reloads, the Claude desktop Electron client, anywhere the
   * iframe finishes loading after we've already called `set-muted` etc).
   * Re-sending current state is idempotent — even at default values it just
   * confirms what the runtime would have done anyway.
   */
  private _replayBridgeState(): void {
    this._sendControl("set-muted", { muted: this.muted });
    this._sendControl("set-volume", { volume: this._volume });
    this._sendControl("set-playback-rate", { playbackRate: this.playbackRate });
  }

  private _reloadShaderOptions(): void {
    if (getShaderModeFromElement(this) !== "player") this.shaderLoader.reset();
    if (this.hasAttribute("srcdoc")) {
      this.iframe.srcdoc = prepareSrcdocForElement(this, this.getAttribute("srcdoc") || "");
      return;
    }
    if (this.hasAttribute("src")) {
      this.iframe.src = prepareSrcForElement(this, this.getAttribute("src") || "");
    }
  }

  private _trySyncSeek(timeInSeconds: number): boolean {
    try {
      const win = this.iframe.contentWindow as
        | (Window & { __player?: { seek?: (t: number) => void } })
        | null;
      const player = win?.__player;
      if (typeof player?.seek !== "function") return false;
      player.seek.call(player, timeInSeconds);
      return true;
    } catch {
      return false;
    }
  }

  private _withDirectTimeline(fn: (tl: DirectTimelineAdapter) => void): boolean {
    const tl = this._directTimelineAdapter || this.probe.resolveDirectTimelineAdapter();
    if (!tl) return false;
    try {
      fn(tl);
      this._directTimelineAdapter = tl;
      return true;
    } catch {
      return false;
    }
  }

  // GSAP seek() preserves play state; player seek() contract lands paused.
  private _tryDirectTimelineSeek(t: number): boolean {
    return this._withDirectTimeline((tl) => {
      tl.seek(t);
      tl.pause();
    });
  }
  private _tryDirectTimelinePlay(): boolean {
    return this._withDirectTimeline((tl) => void tl.play());
  }
  private _tryDirectTimelinePause(): boolean {
    return this._withDirectTimeline((tl) => void tl.pause());
  }

  /**
   * Widget-frame RAF loop that sends "tick" postMessages to the composition
   * iframe on every frame. Used for the runtime bridge path so that animation
   * advances even when the composition iframe's own rAF is throttled by
   * Chromium (e.g. deeply nested cross-origin iframes in Electron / Claude desktop).
   * The runtime's own rAF loop still runs — ticking GSAP twice per frame is
   * harmless because seekTimelineAndAdapters is idempotent.
   */
  private _startParentTickClock(): void {
    this._stopParentTickClock();
    const tick = () => {
      if (this._paused) {
        this._parentTickRaf = null;
        return;
      }
      this._sendControl("tick");
      this._parentTickRaf = requestAnimationFrame(tick);
    };
    this._parentTickRaf = requestAnimationFrame(tick);
  }

  private _stopParentTickClock(): void {
    if (this._parentTickRaf === null) return;
    cancelAnimationFrame(this._parentTickRaf);
    this._parentTickRaf = null;
  }

  private _onMessage(e: MessageEvent) {
    handleRuntimeMessage(e, this.iframe.contentWindow, {
      getPlaybackState: () => ({
        currentTime: this._currentTime,
        duration: this._duration,
        paused: this._paused,
        lastUpdateMs: this._lastUpdateMs,
      }),
      setPlaybackState: ({ currentTime, duration, paused, lastUpdateMs }) => {
        this._currentTime = currentTime;
        this._duration = duration;
        this._paused = paused;
        this._lastUpdateMs = lastUpdateMs;
      },
      getShaderLoadingMode: () => getShaderModeFromElement(this),
      shaderLoader: this.shaderLoader,
      setCompositionSize: (w, h) => {
        this._compositionWidth = w;
        this._compositionHeight = h;
        this._rescale();
      },
      sendControl: (action, extra) => this._sendControl(action, extra),
      getIframeDoc: () => this.iframe.contentDocument,
      onRuntimeReady: () => this._replayBridgeState(),
      updateControlsTime: (t, d) => this.controlsApi?.updateTime(t, d),
      updateControlsPlaying: (p) => this.controlsApi?.updatePlaying(p),
      dispatchEvent: (ev) => this.dispatchEvent(ev),
      seek: (t) => this.seek(t),
      play: () => this.play(),
      getLoop: () => this.loop,
      media: this._media,
    });
  }

  private _onProbeReady({ duration, adapter, compositionSize }: ProbeResult) {
    this._duration = duration;
    this._directTimelineAdapter = adapter.kind === "direct-timeline" ? adapter.timeline : null;
    this._ready = true;
    this.controlsApi?.updateTime(0, duration);
    this.dispatchEvent(new CustomEvent("ready", { detail: { duration } }));
    if (compositionSize) {
      this._compositionWidth = compositionSize.width;
      this._compositionHeight = compositionSize.height;
      this._rescale();
    }
    try {
      const doc = this.iframe.contentDocument;
      if (doc) this._media.setupFromIframe(doc);
    } catch {
      /* cross-origin */
    }
    if (this.hasAttribute("autoplay")) this.play();
  }

  private _rescale() {
    scaleIframeToFit(this, this.iframe, this._compositionWidth, this._compositionHeight);
  }

  private _onIframeLoad() {
    this._directTimelineAdapter = null;
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    this.shaderLoader.reset();
    this._media.resetForIframeLoad();
    this.probe.start();
  }

  private _setupControls() {
    if (this.controlsApi) return;
    this.controlsApi = setupControls(
      this.shadow,
      this.muted,
      this._volume,
      this.getAttribute("speed-presets"),
      {
        onPlay: () => this.play(),
        onPause: () => this.pause(),
        onSeek: (f) => this.seek(f * this._duration),
        onSpeedChange: (s) => void (this.playbackRate = s),
        onMuteToggle: () => void (this.muted = !this.muted),
        onVolumeChange: (v) => void (this.volume = v),
      },
      this._isAudioLocked(),
    );
  }

  // Test-instrumentation pass-throughs (match original field names).
  get _audioOwner() {
    return this._media.audioOwner;
  }
  get _parentMedia() {
    return this._media.entries;
  }
  _mirrorParentMediaTime(t: number, opts?: { force?: boolean }) {
    this._media.mirrorTime(t, opts);
  }
  _promoteToParentProxy() {
    let d: Document | null = null;
    try {
      d = this.iframe.contentDocument;
    } catch {
      /* x-origin */
    }
    this._media.promoteToParentProxy(d, (t, o) => this._mirrorParentMediaTime(t, o));
    this._sendControl("set-media-output-muted", { muted: true });
  }
  _observeDynamicMedia(doc: Document) {
    this._media.setupFromIframe(doc);
  }
}

if (!customElements.get("hyperframes-player")) {
  customElements.define("hyperframes-player", HyperframesPlayer);
}

export { HyperframesPlayer };
export { formatTime, formatSpeed, SPEED_PRESETS } from "./controls.js";
export type { ControlsCallbacks, ControlsOptions } from "./controls.js";
export type { ShaderLoadingMode } from "./shader-options.js";
