import { CompositionProbe, type ProbeResult, readPositiveDimension } from "./composition-probe.js";
import { isControlsClick, setupControls, setupPoster } from "./controls-setup.js";
import { adoptShadowStyles, createCompositionIframe, scaleIframeToFit } from "./iframe-dom.js";
import { DirectTimelineClock } from "./direct-timeline-clock.js";
import { ParentMediaManager } from "./parent-media.js";
import { isRealmHtmlMediaElement } from "./media-element-guards.js";
import { handleRuntimeMessage } from "./runtime-message-handler.js";
import {
  SHADER_CAPTURE_SCALE_ATTR,
  SHADER_LOADING_ATTR,
  RUNTIME_SRC_ATTR,
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
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import {
  FIRST_FRAME_READINESS_SCOPE,
  scanPendingCompositionAssets,
  settleFirstFrameCompositionReadiness,
} from "@hyperframes/core/composition-readiness";

// Playback-rate bounds mirror the runtime clamp in
// packages/core/src/runtime/init.ts (applyPlaybackRate) and media.ts so the
// player accepts the same range as the in-iframe runtime: an out-of-range rate
// would otherwise drive the parent-proxied <audio> outside the bounds the
// timeline itself respects. Clamping here also shields the native
// HTMLMediaElement.playbackRate setter, which throws for extreme values in
// production browsers.
const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 5;
const SANDBOX_ORIGIN_ATTR = "sandbox-origin";
const RUNTIME_DATA_DELIVERY_TIMEOUT_MS = 10_000;
// Bounds how long the player waits on a same-origin composition's readiness
// inputs (media, compute, paint-and-idle) before playing anyway — a stuck
// asset or a composition that never goes quiet must not block playback forever.
const ASSETS_READY_TIMEOUT_MS = 8_000;
const ASSETS_LOADING_ATTR = "assets-loading";
// "player" (default) draws the loading-assets card; "none" never does, like shader-loading="none".
const ASSETS_LOADING_UI_ATTR = "assets-loading-ui";
const LOW_POWER_IDLE_ATTR = "low-power-idle";
const DISABLE_CLICK_TO_PLAY_ATTR = "disable-click-to-play";
// paint-and-idle now always has a frame to wait on, so the overlay would
// flash on every single Play without this debounce. ponytail: 150ms is
// unmeasured, retune once there's production data on paint-and-idle timing.
const ASSETS_LOADING_SHOW_DELAY_MS = 150;

export type ColorGradingTarget =
  | string
  | {
      id?: string | null;
      hfId?: string | null;
      selector?: string | null;
      selectorIndex?: number | null;
    };

export type ColorGradingCompareState = {
  enabled: boolean;
  position?: number;
  softness?: number;
  lineWidth?: number;
};

type RuntimeDataBridge = {
  setRuntimeData?: (channel: string, payload: unknown, requestId?: number) => void;
  clearRuntimeData?: (channel: string, requestId?: number) => void;
};

type PendingRuntimeDataDelivery = {
  requestId: number;
  timeoutId: number;
};

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
      SANDBOX_ORIGIN_ATTR,
      RUNTIME_SRC_ATTR,
      SHADER_CAPTURE_SCALE_ATTR,
      SHADER_LOADING_ATTR,
      ASSETS_LOADING_UI_ATTR,
      LOW_POWER_IDLE_ATTR,
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
  private _readyDocument: Document | null = null;
  private _assetsReady = false;
  private _painted = false;
  private _pendingPlay = false;
  private _assetsGeneration = 0;
  private _assetsLoadingShowTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentTime = 0;
  private _duration = 0;
  private _paused = true;
  /** True while the user is dragging the scrubber — makes seek() play audio at the
   * playhead (audible scrub) instead of positioning it silently. */
  private _scrubbing = false;
  private _lastUpdateMs = 0;
  private _volume = 1;
  private _compositionWidth = 1920;
  private _compositionHeight = 1080;
  private _rescaleWarned = false;
  private _directTimelineAdapter: DirectTimelineAdapter | null = null;
  private _directTimelineClock: DirectTimelineClock;
  private _parentTickRaf: number | null = null;
  private _media: ParentMediaManager;
  private _scenes: { id: string; start: number; duration: number }[] = [];
  private _runtimeFps = 30;
  private _runtimeBridgeReady = false;
  private _runtimeAssetsReadyGeneration = -1;
  private _runtimeData = new Map<string, unknown>();
  private _runtimeDataRequestId = 0;
  private _pendingRuntimeData = new Map<string, PendingRuntimeDataDelivery>();
  private _afterUpdate: Array<() => void> | null = null;

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
      dispatchEvent: (e) => this._emit(e),
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
        this._emit(new CustomEvent("timeupdate", { detail: { currentTime } }));
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
        this._emit(new Event("ended"));
      },
      onEnded: () => this.loop,
    });

    this.probe = new CompositionProbe(this.iframe, {
      onReady: (result) => this._onProbeReady(result),
      onError: (message) => this._emit(new CustomEvent("error", { detail: { message } })),
    });

    this.addEventListener("click", (event) => {
      if (this.disableClickToPlay || isControlsClick(event)) return;
      if (this._paused) this.play();
      else this.pause();
    });

    this.resizeObserver = new ResizeObserver(() => this._rescale());
    this._onMessage = this._onMessage.bind(this);
    this._onIframeLoad = this._onIframeLoad.bind(this);
  }

  connectedCallback() {
    this._applySandboxOriginPolicy();
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
    this._sendControl("pause");
    this._stopIframeMedia();
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
    this.controlsApi = null;
    this._paused = true;
    this._pendingPlay = false;
    this._abandonComposition("Player disconnected before runtime data was applied");
  }

  // fallow-ignore-next-line complexity
  attributeChangedCallback(name: string, oldVal: string | null, val: string | null) {
    switch (name) {
      case "src":
        // Custom-element attributes are normally assigned before insertion (React does this for
        // every render). Navigating the inner iframe here would let its one-shot runtime `ready`
        // message fire before connectedCallback installs the parent message listener. Initial
        // attributes are applied below by connectedCallback; only live changes navigate here.
        if (!this.isConnected) break;
        if (val) {
          // A different composition: like a <video> given a new src, it does not inherit a queued play.
          this._pendingPlay = false;
          this._abandonComposition("Composition navigated before runtime data was applied");
          this.iframe.src = prepareSrcForElement(this, val);
        }
        break;
      case "srcdoc":
        if (!this.isConnected) break;
        this._pendingPlay = false;
        this._abandonComposition("Composition navigated before runtime data was applied");
        if (val !== null) this.iframe.srcdoc = prepareSrcdocForElement(this, val);
        else this.iframe.removeAttribute("srcdoc");
        break;
      case SANDBOX_ORIGIN_ATTR:
        this._applySandboxOriginPolicy(this.isConnected && oldVal !== val);
        break;
      // Reject NaN/zero/negative dimensions the same way the composition
      // probe does (a typo like width="abc" or width="0" would otherwise
      // reach scaleIframeToFit as scale(NaN) or a division by zero and
      // blank the player); fall back to the defaults instead.
      case "width":
        this._setCompositionSize(readPositiveDimension(val) ?? 1920, this._compositionHeight);
        break;
      case "height":
        this._setCompositionSize(this._compositionWidth, readPositiveDimension(val) ?? 1080);
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
        this._emit(new Event("ratechange"));
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
        this._emit(new Event("volumechange"));
        break;
      }
      case "audio-src":
        if (val) this._media.setupFromUrl(val);
        else this._media.teardownUrlAudio();
        break;
      case ASSETS_LOADING_UI_ATTR:
        if (val === "none") this.shaderLoader.hideAssetsLoading();
        break;
      case LOW_POWER_IDLE_ATTR:
        this._sendControl("set-idle-heartbeat", { slow: val !== null });
        break;
      case SHADER_CAPTURE_SCALE_ATTR:
      case SHADER_LOADING_ATTR:
      case RUNTIME_SRC_ATTR:
        if (!this.isConnected) break;
        this._reloadShaderOptions();
        break;
    }
  }

  private _applySandboxOriginPolicy(reloadActiveDocument = false): void {
    if (this.hasAttribute(SANDBOX_ORIGIN_ATTR)) {
      this.iframe.sandbox.remove("allow-same-origin");
    } else {
      this.iframe.sandbox.add("allow-same-origin");
    }
    if (reloadActiveDocument) this._reloadForSandboxOriginPolicy();
  }

  private _reloadForSandboxOriginPolicy(): void {
    this._abandonComposition("Sandbox policy changed before runtime data was applied");
    const srcdoc = this.getAttribute("srcdoc");
    if (srcdoc !== null) {
      this.iframe.srcdoc = prepareSrcdocForElement(this, srcdoc);
      return;
    }
    const src = this.getAttribute("src");
    this.iframe.src = src === null ? "about:blank" : prepareSrcForElement(this, src);
  }

  /**
   * The inner `<iframe>` rendering the composition. Use this when integrating
   * with tools that need `contentWindow` — `.contentWindow` on the
   * `<hyperframes-player>` element itself returns `null` (Shadow DOM).
   */
  get iframeElement(): HTMLIFrameElement {
    return this.iframe;
  }

  /** Scene list from the last-received runtime timeline message. Empty until
   *  the composition runtime fires its first "timeline" postMessage. */
  get scenes(): { id: string; start: number; duration: number }[] {
    return this._scenes;
  }

  // fallow-ignore-next-line complexity
  play() {
    if (this._ready && !this._assetsReady) {
      this._pendingPlay = true;
      return;
    }
    this._pendingPlay = false;
    this.posterEl?.remove();
    this.posterEl = null;
    if (this._duration > 0 && this._currentTime >= this._duration) this.seek(0);
    // Must be set before _startParentTickClock so the RAF loop's `_paused`
    // check doesn't immediately self-terminate on the first callback.
    this._paused = false;
    const directTimelineStarted = this._tryDirectTimelinePlay();
    // Set when the probe hasn't resolved yet: retried from _onProbeReady /
    // _onRuntimeTimelineReady once ready, which is the call that actually
    // starts playback — this premature call must not ALSO dispatch "play"
    // for what hasn't started, or a host listener sees it fire twice.
    let queuedForReady = false;
    if (!directTimelineStarted) {
      this._sendControl("play");
      // Only start the parent tick clock once the composition is ready and
      // confirmed on the runtime bridge path (not the direct-timeline path).
      if (this._ready && !this._directTimelineAdapter) {
        this._startParentTickClock();
      } else if (!this._ready) {
        this._pendingPlay = true;
        queuedForReady = true;
      }
    }
    if (this._media.audioOwner === "parent") this._media.playAll();
    this.controlsApi?.updatePlaying(true);
    if (!queuedForReady) this._emit(new Event("play"));
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
    // A play queued while assets were still buffering must not survive an
    // explicit user pause — otherwise it fires once assets settle, seconds
    // after the user stopped playback.
    this._pendingPlay = false;
    if (!this._tryDirectTimelinePause()) this._sendControl("pause");
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    if (this._media.audioOwner === "parent") this._media.pauseAll();
    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this._emit(new Event("pause"));
  }

  stopMedia() {
    this._sendControl("stop-media");
    this._stopIframeMedia();
    this._media.stopAdoptedMedia();
  }

  seek(timeInSeconds: number) {
    // seek()'s own contract is that it lands paused, so a play still queued
    // from the asset-buffering window is cancelled here too — same reason as
    // pause() above.
    this._pendingPlay = false;
    if (!this._trySyncSeek(timeInSeconds) && !this._tryDirectTimelineSeek(timeInSeconds)) {
      this._sendControl("seek", {
        timeSeconds: timeInSeconds,
        // Legacy runtimes read only `frame`. Protocol-v1 runtimes prefer
        // `timeSeconds`, so carrying both keeps cross-origin embeds seekable
        // while preserving seconds-first precision between current peers.
        frame: Math.round(timeInSeconds * this._runtimeFps),
      });
    }
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    this._currentTime = timeInSeconds;
    if (this._media.audioOwner === "parent") {
      if (this._scrubbing) {
        // Audible scrub: play the proxy audio at the playhead so the viewer hears
        // the track as they drag. Each move re-seeks, restarting playback from the
        // new position. onScrubEnd settles back to silence via a normal seek.
        this._media.scrubAll(timeInSeconds);
      } else {
        // Pause BEFORE seek: leaving the proxy playing turns the next
        // `mirrorTime` drift-correction tick into a perpetual seek→play→drift→seek
        // stutter loop, where ~80ms of audio plays past the (now frozen) timeline,
        // then mirrorTime yanks `currentTime` back to match it. Symmetric with
        // `pause()` below.
        this._media.pauseAll();
        this._media.seekAll(timeInSeconds);
      }
    }
    this._paused = true;
    this.controlsApi?.updatePlaying(false);
    this.controlsApi?.updateTime(this._currentTime, this._duration);
  }

  setColorGrading(target: ColorGradingTarget, grading: unknown) {
    this._sendControl("set-color-grading", { target, grading });
  }

  clearColorGrading(target: ColorGradingTarget) {
    this._sendControl("set-color-grading", { target, grading: null });
  }

  setColorGradingCompare(target: ColorGradingTarget, compare: ColorGradingCompareState) {
    this._sendControl("set-color-grading-compare", { target, compare });
  }

  clearColorGradingCompare(target: ColorGradingTarget) {
    this._sendControl("set-color-grading-compare", {
      target,
      compare: { enabled: false },
    });
  }

  /** Retain and deliver structured runtime data through the shared runtime protocol. */
  setRuntimeData(channel: string, payload: unknown): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(channel)) {
      throw new Error(`Invalid HyperFrames runtime-data channel: ${channel}`);
    }
    if (typeof structuredClone !== "function") {
      throw new Error(
        "HyperFrames runtime data requires structuredClone support; refusing an unverified payload",
      );
    }
    const retained = structuredClone(payload);
    this._runtimeData.set(channel, retained);
    this._deliverRuntimeData(channel, retained);
  }

  clearRuntimeData(channel: string): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(channel)) {
      throw new Error(`Invalid HyperFrames runtime-data channel: ${channel}`);
    }
    this._runtimeData.delete(channel);
    this._deliverRuntimeDataClear(channel);
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

  /** The composition's width, from the runtime or the `width` attribute. */
  get compositionWidth() {
    return this._compositionWidth;
  }
  /** The composition's height, from the runtime or the `height` attribute. */
  get compositionHeight() {
    return this._compositionHeight;
  }
  get paused() {
    return this._paused;
  }
  get ready() {
    return this._ready;
  }

  /** True once every readiness input (media, compute, paint-and-idle) has
   *  settled or the wait timed out. Mirrors `assetsready`. Always true for
   *  cross-origin compositions, which the player has no DOM access to wait on. */
  get assetsReady() {
    return this._assetsReady;
  }

  /** True once assets are ready and the loading panel has finished fading out,
   *  so the document is what is on screen. Mirrors `painted`; resets per load. */
  get painted() {
    return this._painted;
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

  get assetsLoadingUi(): "player" | "none" {
    return this.getAttribute(ASSETS_LOADING_UI_ATTR) === "none" ? "none" : "player";
  }
  set assetsLoadingUi(mode: "player" | "none") {
    if (mode === "none") this.setAttribute(ASSETS_LOADING_UI_ATTR, "none");
    else this.removeAttribute(ASSETS_LOADING_UI_ATTR);
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

  private _isSlideshowPlayer(): boolean {
    return this.closest("hyperframes-slideshow") !== null;
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
    this._setIframeMediaMuted(val !== null);
    this._sendControl("set-muted", { muted: val !== null });
    this.controlsApi?.updateMuted(val !== null);
    this._emit(new Event("volumechange"));
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

  get disableClickToPlay() {
    return this.hasAttribute(DISABLE_CLICK_TO_PLAY_ATTR);
  }
  set disableClickToPlay(disabled: boolean) {
    this.toggleAttribute(DISABLE_CLICK_TO_PLAY_ATTR, disabled);
  }

  get loop() {
    return this.hasAttribute("loop");
  }
  set loop(l: boolean) {
    if (l) this.setAttribute("loop", "");
    else this.removeAttribute("loop");
  }

  private _sendControl(action: string, extra: Record<string, unknown> = {}): boolean {
    try {
      const frameWindow = this.iframe.contentWindow;
      if (!frameWindow) {
        if (action === "set-runtime-data" || action === "clear-runtime-data") {
          this._rejectRuntimeDataDelivery(
            extra["channel"],
            extra["requestId"],
            "Composition iframe is unavailable",
          );
        }
        return false;
      }
      frameWindow.postMessage(
        {
          ...extra,
          source: "hf-parent",
          type: "control",
          action,
          ...runtimeProtocolMetadata(this._runtimeFps),
        },
        "*",
      );
      return true;
    } catch (error) {
      if (action === "set-runtime-data" || action === "clear-runtime-data") {
        this._rejectRuntimeDataDelivery(
          extra["channel"],
          extra["requestId"],
          error instanceof Error ? error.message : String(error),
        );
      }
      return false;
    }
  }

  private _deliverRuntimeData(channel: string, payload: unknown): void {
    if (!this.isConnected || !this._runtimeBridgeReady) return;
    const requestId = this._beginRuntimeDataDelivery(channel);
    if (this._trySetRuntimeDataDirect(channel, payload, requestId)) return;
    this._sendControl("set-runtime-data", { channel, payload, requestId });
  }

  private _deliverRuntimeDataClear(channel: string): void {
    if (!this.isConnected || !this._runtimeBridgeReady) return;
    const requestId = this._beginRuntimeDataDelivery(channel);
    if (this._tryClearRuntimeDataDirect(channel, requestId)) return;
    this._sendControl("clear-runtime-data", { channel, requestId });
  }

  private _trySetRuntimeDataDirect(channel: string, payload: unknown, requestId: number): boolean {
    try {
      const bridge = (
        this.iframe.contentWindow as (Window & { __hyperframes?: RuntimeDataBridge }) | null
      )?.__hyperframes;
      if (typeof bridge?.setRuntimeData !== "function") return false;
      bridge.setRuntimeData(channel, payload, requestId);
      return true;
    } catch {
      return false;
    }
  }

  private _tryClearRuntimeDataDirect(channel: string, requestId: number): boolean {
    try {
      const bridge = (
        this.iframe.contentWindow as (Window & { __hyperframes?: RuntimeDataBridge }) | null
      )?.__hyperframes;
      if (typeof bridge?.clearRuntimeData !== "function") return false;
      bridge.clearRuntimeData(channel, requestId);
      return true;
    } catch {
      return false;
    }
  }

  private _replayRuntimeData(): void {
    for (const [channel, payload] of this._runtimeData) {
      this._deliverRuntimeData(channel, payload);
    }
  }

  private _beginRuntimeDataDelivery(channel: string): number {
    const previous = this._pendingRuntimeData.get(channel);
    if (previous) window.clearTimeout(previous.timeoutId);
    this._runtimeDataRequestId += 1;
    const requestId = this._runtimeDataRequestId;
    const timeoutId = window.setTimeout(() => {
      this._rejectRuntimeDataDelivery(
        channel,
        requestId,
        `Runtime data delivery timed out after ${RUNTIME_DATA_DELIVERY_TIMEOUT_MS}ms`,
      );
    }, RUNTIME_DATA_DELIVERY_TIMEOUT_MS);
    this._pendingRuntimeData.set(channel, { requestId, timeoutId });
    return requestId;
  }

  private _resolveRuntimeDataDelivery(channel: unknown, requestId: unknown): void {
    const pending = this._takeRuntimeDataDelivery(channel, requestId);
    if (!pending) return;
    this._emit(
      new CustomEvent("runtimedataapplied", {
        detail: { channel, requestId: pending.requestId },
      }),
    );
  }

  private _rejectRuntimeDataDelivery(channel: unknown, requestId: unknown, message: unknown): void {
    const pending = this._takeRuntimeDataDelivery(channel, requestId);
    if (!pending) return;
    this._emit(
      new CustomEvent("runtimedataerror", {
        detail: {
          channel,
          requestId: pending.requestId,
          message: typeof message === "string" ? message : String(message),
        },
      }),
    );
  }

  private _takeRuntimeDataDelivery(
    channel: unknown,
    requestId: unknown,
  ): PendingRuntimeDataDelivery | null {
    if (
      typeof channel !== "string" ||
      typeof requestId !== "number" ||
      !Number.isSafeInteger(requestId)
    )
      return null;
    const pending = this._pendingRuntimeData.get(channel);
    if (!pending || pending.requestId !== requestId) return null;
    window.clearTimeout(pending.timeoutId);
    this._pendingRuntimeData.delete(channel);
    return pending;
  }

  private _rejectAllRuntimeDataDeliveries(message: string): void {
    for (const [channel, pending] of [...this._pendingRuntimeData]) {
      this._rejectRuntimeDataDelivery(channel, pending.requestId, message);
    }
  }

  /**
   * Returns the iframe's contentDocument if same-origin and reachable,
   * otherwise null. Accessing contentDocument can throw on cross-origin
   * iframes — this swallows that as a clean null sentinel.
   */
  private _getSameOriginIframeDocument(): Document | null {
    try {
      return this.iframe.contentDocument;
    } catch {
      return null;
    }
  }

  private _setIframeMediaMuted(muted: boolean): void {
    const iframeDoc = this._getSameOriginIframeDocument();
    if (!iframeDoc) return;
    for (const el of iframeDoc.querySelectorAll("video, audio")) {
      if (isRealmHtmlMediaElement(el)) el.muted = muted || el.defaultMuted;
    }
  }

  private _stopIframeMedia(): void {
    const iframeDoc = this._getSameOriginIframeDocument();
    if (!iframeDoc) return;
    for (const el of iframeDoc.querySelectorAll("video, audio")) {
      if (isRealmHtmlMediaElement(el)) el.pause();
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
    this._sendControl("set-native-media-sync-disabled", {
      disabled: this._isSlideshowPlayer(),
    });
    this._sendControl("set-web-audio-media-disabled", {
      disabled: this._isSlideshowPlayer(),
    });
    this._sendControl("set-idle-heartbeat", { slow: this.hasAttribute(LOW_POWER_IDLE_ATTR) });
  }

  private _reloadShaderOptions(): void {
    // This navigates the frame, so readiness has to fall with it. Leaving
    // `_runtimeBridgeReady` true lets a delivery post into a document that is being
    // replaced, where it can only end in a delivery timeout rather than the immediate,
    // explanatory rejection the caller gets from every other navigating path.
    this._abandonComposition("Shader options changed before runtime data was applied");
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
    const resolved = this.probe.resolveDirectTimelineAdapter();
    const tl = resolved || this._directTimelineAdapter;
    if (!tl) return false;
    try {
      fn(tl);
      if (resolved && resolved !== this._directTimelineAdapter) {
        const duration = resolved.duration();
        if (Number.isFinite(duration) && duration > 0) {
          this._setDuration(duration);
          this.controlsApi?.updateTime(this._currentTime, duration);
        }
      }
      this._directTimelineAdapter = tl;
      return true;
    } catch {
      return false;
    }
  }

  // GSAP seek() preserves play state; player seek() contract lands paused.
  private _tryDirectTimelineSeek(t: number): boolean {
    return this._withDirectTimeline((tl) => {
      // suppressEvents=false: fire the timeline's onUpdate so compositions that
      // drive scene visibility imperatively (via the root timeline's onUpdate,
      // e.g. slideshow decks) repaint on a paused seek — not only while playing.
      tl.seek(t, false);
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
    this._applyThenEmit(() => this._handleRuntimeMessage(e));
  }

  private _handleRuntimeMessage(e: MessageEvent) {
    handleRuntimeMessage(e, this.iframe.contentWindow, {
      getPlaybackState: () => ({
        currentTime: this._currentTime,
        duration: this._duration,
        paused: this._paused,
        lastUpdateMs: this._lastUpdateMs,
      }),
      setPlaybackState: ({ currentTime, duration, paused, lastUpdateMs }) => {
        this._currentTime = currentTime;
        this._setDuration(duration);
        this._paused = paused;
        this._lastUpdateMs = lastUpdateMs;
      },
      getShaderLoadingMode: () => getShaderModeFromElement(this),
      shaderLoader: this.shaderLoader,
      setCompositionSize: (w, h) => this._setCompositionSize(w, h),
      sendControl: (action, extra) => this._sendControl(action, extra),
      getIframeDoc: () => this.iframe.contentDocument,
      onRuntimeReady: () => {
        this._runtimeBridgeReady = true;
        this._replayBridgeState();
        this._replayRuntimeData();
      },
      onRuntimeAssetsReady: () => {
        if (this._runtimeAssetsReadyGeneration === this._assetsGeneration) {
          this._settleAssetsReady(this._assetsGeneration);
        }
      },
      onRuntimeDataApplied: (channel, requestId) =>
        this._resolveRuntimeDataDelivery(channel, requestId),
      onRuntimeDataError: (channel, requestId, message) =>
        this._rejectRuntimeDataDelivery(channel, requestId, message),
      onRuntimeTimelineReady: (duration, assetsReady) =>
        this._onRuntimeTimelineReady(duration, assetsReady),
      setRuntimeFps: (fps) => {
        this._runtimeFps = fps;
      },
      shouldPromoteMediaAutoplayFallback: () => !this._isSlideshowPlayer(),
      setScenes: (scenes) => {
        this._scenes = scenes;
        this._emit(new CustomEvent("scenes", { detail: { scenes } }));
      },
      updateControlsTime: (t, d) => this.controlsApi?.updateTime(t, d),
      updateControlsPlaying: (p) => this.controlsApi?.updatePlaying(p),
      dispatchEvent: (ev) => this._emit(ev),
      seek: (t) => this.seek(t),
      play: () => this.play(),
      getLoop: () => this.loop,
      media: this._media,
    });
  }

  private _onRuntimeTimelineReady(duration: number, assetsReady: boolean | undefined) {
    if (this._ready) return;
    this.probe.stop();
    this._setDuration(duration);
    this._directTimelineAdapter = null;
    this._ready = true;
    this.controlsApi?.updateTime(this._currentTime, duration);
    this._dispatchReady();

    const doc = this._getSameOriginIframeDocument();
    if (doc) this._media.setupFromIframe(doc);

    this._replayBridgeState();
    this._setIframeMediaMuted(this.muted);
    this._waitForAssetsReady(doc, assetsReady);
    this._playWhenWanted();
  }

  private _onProbeReady(result: ProbeResult) {
    this._applyThenEmit(() => this._applyProbeResult(result));
  }

  private _applyProbeResult({ duration, adapter, compositionSize }: ProbeResult) {
    this._setDuration(duration);
    this._directTimelineAdapter = adapter.kind === "direct-timeline" ? adapter.timeline : null;
    if (compositionSize) this._setCompositionSize(compositionSize.width, compositionSize.height);
    this._ready = true;
    this.controlsApi?.updateTime(0, duration);
    this._dispatchReady();
    const doc = this._getSameOriginIframeDocument();
    if (doc) this._media.setupFromIframe(doc);
    this._setIframeMediaMuted(this.muted);
    this._waitForAssetsReady(doc);
    this._playWhenWanted();
  }

  /** Gates play() on composition readiness (media, compute, paint-and-idle),
   * bounded by ASSETS_READY_TIMEOUT_MS. The overlay is debounced by
   * ASSETS_LOADING_SHOW_DELAY_MS rather than shown the instant a wait
   * starts, since one is now pending on nearly every Play. */
  private _waitForAssetsReady(doc: Document | null, runtimeAssetsReady?: boolean): void {
    this._clearAssetsLoadingShowTimer();
    this._assetsReady = false;
    this._painted = false;
    // Invalidates any earlier wait still in flight (a composition swap, or
    // disconnect, mid-wait) — its eventual settle checks this and no-ops
    // rather than resolving a since-superseded generation.
    const generation = ++this._assetsGeneration;
    if (!doc) {
      // An opaque-origin iframe cannot be scanned from here; a runtime that
      // reports `assetsReady: false` runs the same scan itself and posts the result.
      if (runtimeAssetsReady === false) {
        this._runtimeAssetsReadyGeneration = generation;
        this._startAssetsLoadingOverlayTimer(generation);
        setTimeout(() => this._settleAssetsReady(generation), ASSETS_READY_TIMEOUT_MS);
      } else {
        this._settleAssetsReady(generation);
      }
      return;
    }
    settleFirstFrameCompositionReadiness(
      doc,
      ({ timedOut }) => {
        if (generation !== this._assetsGeneration) return;
        if (timedOut) this._warnStuckAssets(doc);
        this._settleAssetsReady(generation);
      },
      { timeoutMs: ASSETS_READY_TIMEOUT_MS },
    );
    if (!this._assetsReady) this._startAssetsLoadingOverlayTimer(generation);
  }

  private _startAssetsLoadingOverlayTimer(generation: number): void {
    this._assetsLoadingShowTimer = setTimeout(() => {
      this._assetsLoadingShowTimer = null;
      if (generation !== this._assetsGeneration || this._assetsReady) return;
      this.setAttribute(ASSETS_LOADING_ATTR, "");
      if (this.assetsLoadingUi !== "none") this.shaderLoader.showAssetsLoading();
    }, ASSETS_LOADING_SHOW_DELAY_MS);
  }

  /** Timeout diagnostic. Re-scans since some assets may have resolved by
   *  now. Compute can cause the timeout, so it's reported too. A hidden
   *  document can starve paint-and-idle of frames for the full 8s — that's
   *  reported directly rather than inferred, since it can't be bounded. */
  private _warnStuckAssets(doc: Document): void {
    const { pendingMedia, pendingImages, fontsLoading } = scanPendingCompositionAssets(doc, {
      scope: FIRST_FRAME_READINESS_SCOPE,
    });
    const win = doc.defaultView as (Window & { __renderReady?: boolean }) | null;
    console.warn(
      `[hyperframes-player] assets-loading timed out after ${ASSETS_READY_TIMEOUT_MS}ms — playing anyway`,
      {
        stuckMedia: pendingMedia.map(
          (el) => el.currentSrc || el.getAttribute("src") || `<${el.tagName.toLowerCase()}>`,
        ),
        stuckImages: pendingImages.map(
          (img) => img.currentSrc || img.getAttribute("src") || "<img>",
        ),
        fontsLoading,
        computeReady: win?.__renderReady === true,
        documentHidden: doc.hidden === true,
      },
    );
  }

  private _settleAssetsReady(generation: number): void {
    if (generation !== this._assetsGeneration || this._assetsReady) return;
    this._clearAssetsLoadingShowTimer();
    this._assetsReady = true;
    this.removeAttribute(ASSETS_LOADING_ATTR);
    this.shaderLoader.hideAssetsLoading();
    this._emit(new Event("assetsready"));
    this.shaderLoader.whenHidden(() => {
      if (generation !== this._assetsGeneration) return;
      this._painted = true;
      this._emit(new Event("painted"));
    });
    this._afterEvents(() => {
      if (this._pendingPlay) this.play();
    });
  }

  /** Every host-driven navigation or teardown: the old document's handshake, asset wait and
   *  data deliveries end here. A queued play is the caller's, so only its owners clear it. */
  private _abandonComposition(reason: string): void {
    this._ready = false;
    this._readyDocument = null;
    this._invalidateAssetsWait();
    this._releaseDocument();
    this._runtimeBridgeReady = false;
    this._rejectAllRuntimeDataDeliveries(reason);
  }

  private _releaseDocument(): void {
    this._directTimelineAdapter = null;
    this._directTimelineClock.stop();
    this._stopParentTickClock();
    this.shaderLoader.reset();
    this._media.resetForIframeLoad();
  }

  /** Abandons any in-flight asset wait — every `_ready = false` site calls
   *  this first, so a stale wait's settle can't apply to what comes next. */
  private _invalidateAssetsWait(): void {
    this._clearAssetsLoadingShowTimer();
    this._assetsReady = false;
    this._painted = false;
    this._assetsGeneration++;
    this.removeAttribute(ASSETS_LOADING_ATTR);
    this.shaderLoader.hide();
  }

  private _clearAssetsLoadingShowTimer(): void {
    if (this._assetsLoadingShowTimer === null) return;
    clearTimeout(this._assetsLoadingShowTimer);
    this._assetsLoadingShowTimer = null;
  }

  private _dispatchReady(): void {
    this._readyDocument = this._getSameOriginIframeDocument();
    const detail = {
      duration: this._duration,
      compositionWidth: this._compositionWidth,
      compositionHeight: this._compositionHeight,
    };
    this._emit(new CustomEvent("ready", { detail }));
    // Once ready: covers a size message that never came, and lets a zero-size player warn.
    this._rescale();
  }

  /** `ready` carries the first duration; later changes fire `durationchange`. */
  private _setDuration(duration: number): void {
    if (duration === this._duration) return;
    this._duration = duration;
    if (this._ready) this._emit(new CustomEvent("durationchange", { detail: { duration } }));
  }

  private _setCompositionSize(width: number, height: number): void {
    const changed = width !== this._compositionWidth || height !== this._compositionHeight;
    this._compositionWidth = width;
    this._compositionHeight = height;
    this._rescale();
    if (!changed) return;
    const detail = { compositionWidth: width, compositionHeight: height };
    this._emit(new CustomEvent("resize", { detail }));
  }

  /** Runs one update (a runtime message, a probe result), then the events and actions it raised,
   *  so every listener sees the whole update applied. */
  private _applyThenEmit(apply: () => void): void {
    // A nested update joins the outer one's queue.
    if (this._afterUpdate) {
      apply();
      return;
    }
    const queue: Array<() => void> = [];
    this._afterUpdate = queue;
    const errors: unknown[] = [];
    const run = (step: () => void) => {
      try {
        step();
      } catch (error) {
        errors.push(error);
      }
    };
    run(apply);
    // Still open while flushing: whatever a listener raises goes behind the rest.
    for (const action of queue) run(action);
    this._afterUpdate = null;
    if (errors.length > 0) throw errors[0];
  }

  /** Runs `action` once the current update's events have fired (at once outside an update). */
  private _afterEvents(action: () => void): void {
    if (this._afterUpdate) this._afterUpdate.push(action);
    else action();
  }

  /** Autoplay, or a play() made before ready, decided after `ready`'s listeners had their turn. */
  private _playWhenWanted(): void {
    this._afterEvents(() => {
      if (this.hasAttribute("autoplay") || this._pendingPlay) this.play();
    });
  }

  /** Every event the player raises goes through here, so an update's events keep their order. */
  private _emit(event: Event): void {
    this._afterEvents(() => this.dispatchEvent(event));
  }

  private _rescale() {
    const applied = scaleIframeToFit(
      this,
      this.iframe,
      this._compositionWidth,
      this._compositionHeight,
    );
    // A no-op before "ready" is expected (element not painted yet). A no-op
    // once ready means the composition is stuck unscaled/untransformed —
    // pinned to the iframe's default top-left position — with no evidence of
    // why in the field. Surface it once (not on every ResizeObserver tick —
    // a legitimately hidden/zero-sized player, e.g. a collapsed tab or
    // off-screen carousel card, would otherwise spam the console forever).
    if (!applied && this._ready && !this._rescaleWarned) {
      this._rescaleWarned = true;
      console.warn("[hyperframes-player] rescale no-op after ready — zero-size player element", {
        src: this.getAttribute("src"),
        offsetWidth: this.offsetWidth,
        offsetHeight: this.offsetHeight,
        compositionWidth: this._compositionWidth,
        compositionHeight: this._compositionHeight,
      });
    }
  }

  private _onIframeLoad() {
    // The runtime posts its timeline at DOMContentLoaded, before `load`, and every
    // host-initiated navigation clears `_ready` first. So a ready player already holds this
    // document's handshake (an opaque origin reads as null); a paused runtime never posts it again.
    if (this._ready && this._getSameOriginIframeDocument() === this._readyDocument) return;

    this._ready = false;
    // The runtime installs its bridge at DOMContentLoaded, posts `ready`, and only then does the
    // iframe's load event fire. Do not erase that authoritative handshake here: doing so strands
    // retained data set after load until a second `ready` that never comes. Source setters and
    // sandbox-policy reloads already clear bridge readiness before starting a navigation.
    this._invalidateAssetsWait();
    this._releaseDocument();
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
        onScrubStart: () => {
          this._scrubbing = true;
        },
        onScrubEnd: () => {
          this._scrubbing = false;
          // Settle: a normal (silent) seek pauses the proxy audio at the final
          // scrub position, matching the paused playhead.
          this.seek(this._currentTime);
        },
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
