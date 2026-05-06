import { createControls, SPEED_PRESETS, type ControlsCallbacks } from "./controls.js";
import { shouldInjectRuntime } from "./shouldInjectRuntime.js";
import { PLAYER_STYLES } from "./styles.js";

let sharedSheet: CSSStyleSheet | null = null;

function getSharedSheet(): CSSStyleSheet | null {
  if (sharedSheet) return sharedSheet;
  if (typeof CSSStyleSheet === "undefined") return null;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PLAYER_STYLES);
    sharedSheet = sheet;
    return sheet;
  } catch {
    return null;
  }
}

const DEFAULT_FPS = 30;
const RUNTIME_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";
const SHADER_CAPTURE_SCALE_ATTR = "shader-capture-scale";
const SHADER_LOADING_ATTR = "shader-loading";
const SHADER_CAPTURE_SCALE_PARAM = "__hf_shader_capture_scale";
const SHADER_LOADING_PARAM = "__hf_shader_loading";

export type ShaderLoadingMode = "composition" | "player" | "none";

interface ShaderTransitionState {
  ready?: boolean;
  progress?: number;
  total?: number;
  currentTransition?: number;
  transitionTotal?: number;
  transitionFrame?: number;
  transitionFrames?: number;
  phase?: "cached" | "capturing" | "finalizing";
  loading?: boolean;
}

interface ShaderLoaderElements {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  title: HTMLSpanElement;
  detail: HTMLDivElement;
  transitionValue: HTMLSpanElement;
  frameLabel: HTMLSpanElement;
  frameValue: HTMLSpanElement;
  frameRow: HTMLDivElement;
}

const SHADER_LOADING_PHRASES = [
  "Preparing scene transitions",
  "Sampling outgoing scene motion",
  "Sampling incoming scene motion",
  "Caching transition frames",
  "Finalizing transition preview",
];

function normalizeShaderCaptureScale(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.min(1, Math.max(0.25, parsed)));
}

function normalizeShaderLoadingMode(value: string | null): ShaderLoadingMode {
  if (value === null || value.trim() === "") return "composition";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "off"
  ) {
    return "none";
  }
  if (
    normalized === "player" ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "on"
  ) {
    return "player";
  }
  return "composition";
}

function setQueryParam(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

function withShaderQueryParams(
  src: string,
  scale: string | null,
  loadingMode: ShaderLoadingMode,
): string {
  const hashIndex = src.indexOf("#");
  const beforeHash = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  setQueryParam(params, SHADER_CAPTURE_SCALE_PARAM, scale);
  setQueryParam(params, SHADER_LOADING_PARAM, loadingMode === "composition" ? null : loadingMode);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}${hash}`;
}

function injectShaderOptionsIntoSrcdoc(
  html: string,
  scale: string | null,
  loadingMode: ShaderLoadingMode,
): string {
  if (scale === null && loadingMode === "composition") return html;
  const lines: string[] = [];
  if (scale !== null) lines.push(`window.__HF_SHADER_CAPTURE_SCALE=${JSON.stringify(scale)};`);
  if (loadingMode !== "composition") {
    lines.push(`window.__HF_SHADER_LOADING=${JSON.stringify(loadingMode)};`);
  }
  const script = `<script data-hyperframes-player-shader-options>${lines.join("")}</script>`;
  if (/<head\b[^>]*>/i.test(html))
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}${script}`);
  return `${script}${html}`;
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
  private controlsApi: ReturnType<typeof createControls> | null = null;
  private resizeObserver: ResizeObserver;
  private shaderLoaderEl: HTMLDivElement;
  private shaderLoaderFillEl: HTMLDivElement;
  private shaderLoaderTitleEl: HTMLSpanElement;
  private shaderLoaderDetailEl: HTMLDivElement;
  private shaderLoaderTransitionValueEl: HTMLSpanElement;
  private shaderLoaderFrameLabelEl: HTMLSpanElement;
  private shaderLoaderFrameValueEl: HTMLSpanElement;
  private shaderLoaderFrameRowEl: HTMLDivElement;
  private shaderLoaderHideTimeout: ReturnType<typeof setTimeout> | null = null;

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
    /**
     * Count of consecutive steady-state samples in which the proxy's
     * `currentTime` was found drifted beyond `MIRROR_DRIFT_THRESHOLD_SECONDS`.
     * Reset on every in-threshold sample. `_mirrorParentMediaTime` only
     * issues a write once this passes `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES`,
     * which absorbs single-sample jitter (e.g. one slow bridge tick) without
     * thrashing the media element with seeks. Forced calls (promotion,
     * media-added) bypass the gate and reset the counter.
     */
    driftSamples: number;
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

    const sheet = getSharedSheet();
    if (sheet) {
      this.shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style");
      style.textContent = PLAYER_STYLES;
      this.shadow.appendChild(style);
    }

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
    const shaderLoader = this._createShaderLoader();
    this.shaderLoaderEl = shaderLoader.root;
    this.shaderLoaderFillEl = shaderLoader.fill;
    this.shaderLoaderTitleEl = shaderLoader.title;
    this.shaderLoaderDetailEl = shaderLoader.detail;
    this.shaderLoaderTransitionValueEl = shaderLoader.transitionValue;
    this.shaderLoaderFrameLabelEl = shaderLoader.frameLabel;
    this.shaderLoaderFrameValueEl = shaderLoader.frameValue;
    this.shaderLoaderFrameRowEl = shaderLoader.frameRow;
    this.shadow.appendChild(this.shaderLoaderEl);

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
    // srcdoc wins over src per HTML spec when both are set; mirror both attributes
    // so the browser applies the standard precedence rules.
    if (this.hasAttribute("srcdoc"))
      this.iframe.srcdoc = this._prepareSrcdoc(this.getAttribute("srcdoc")!);
    if (this.hasAttribute("src")) this.iframe.src = this._prepareSrc(this.getAttribute("src")!);
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    window.removeEventListener("message", this._onMessage);
    this.iframe.removeEventListener("load", this._onIframeLoad);
    if (this._probeInterval) clearInterval(this._probeInterval);
    if (this.shaderLoaderHideTimeout) clearTimeout(this.shaderLoaderHideTimeout);
    this.shaderLoaderHideTimeout = null;
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
          this.iframe.src = this._prepareSrc(val);
        }
        break;
      case "srcdoc":
        // Distinguish removal (null) from empty-string ("") so callers can clear
        // srcdoc and let src take over. Always reset readiness; the iframe will
        // load a new document either way.
        this._ready = false;
        if (val !== null) this.iframe.srcdoc = this._prepareSrcdoc(val);
        else this.iframe.removeAttribute("srcdoc");
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
      case SHADER_CAPTURE_SCALE_ATTR:
      case SHADER_LOADING_ATTR:
        this._reloadShaderOptions();
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

  /**
   * Move playback to `timeInSeconds`.
   *
   * Two transports, with different precision semantics — read this before
   * writing assertions against `seek` from outside the player:
   *
   * - **Same-origin (sync) path** — when the runtime's `window.__player.seek`
   *   is reachable, we call it directly. `timeInSeconds` is forwarded
   *   *verbatim* (no rounding), so a same-origin scrub of `seek(7.3333)`
   *   lands the runtime at `7.3333 s` — sub-frame precision relative to
   *   `DEFAULT_FPS` (30). Studio scrub UIs that need fractional-frame
   *   alignment (e.g. waveform scrubbing on long-duration audio) get the
   *   exact requested time.
   * - **Cross-origin (postMessage) path** — when same-origin access throws
   *   or `__player.seek` is missing, we fall back to the postMessage bridge.
   *   The wire protocol carries integer frames (`frame: Math.round(t × FPS)`),
   *   so cross-origin embeds are *frame-quantized* and `seek(7.3333)` lands
   *   at `Math.round(7.3333 × 30) / 30 ≈ 7.3333…` (same value here, but for
   *   most fractional inputs you'll see a snap to the nearest 1/30 s).
   *
   * `this._currentTime` always reflects the *requested* `timeInSeconds`
   * regardless of transport, so the controls UI shows the un-quantized value
   * either way; the asymmetry only affects what the runtime actually paints.
   */
  seek(timeInSeconds: number) {
    if (!this._trySyncSeek(timeInSeconds)) {
      const frame = Math.round(timeInSeconds * DEFAULT_FPS);
      this._sendControl("seek", { frame });
    }
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

  get shaderCaptureScale() {
    return Number(normalizeShaderCaptureScale(this.getAttribute(SHADER_CAPTURE_SCALE_ATTR)) ?? "1");
  }
  set shaderCaptureScale(scale: number) {
    this.setAttribute(SHADER_CAPTURE_SCALE_ATTR, String(scale));
  }

  get shaderLoading() {
    return normalizeShaderLoadingMode(this.getAttribute(SHADER_LOADING_ATTR));
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

  private _shaderCaptureScaleParam(): string | null {
    return normalizeShaderCaptureScale(this.getAttribute(SHADER_CAPTURE_SCALE_ATTR));
  }

  private _shaderLoadingMode(): ShaderLoadingMode {
    return normalizeShaderLoadingMode(this.getAttribute(SHADER_LOADING_ATTR));
  }

  private _prepareSrc(src: string): string {
    return withShaderQueryParams(src, this._shaderCaptureScaleParam(), this._shaderLoadingMode());
  }

  private _prepareSrcdoc(srcdoc: string): string {
    return injectShaderOptionsIntoSrcdoc(
      srcdoc,
      this._shaderCaptureScaleParam(),
      this._shaderLoadingMode(),
    );
  }

  private _reloadShaderOptions(): void {
    if (this._shaderLoadingMode() !== "player") {
      this._resetShaderLoader();
    }
    if (this.hasAttribute("srcdoc")) {
      this.iframe.srcdoc = this._prepareSrcdoc(this.getAttribute("srcdoc") || "");
      return;
    }
    if (this.hasAttribute("src")) {
      this.iframe.src = this._prepareSrc(this.getAttribute("src") || "");
    }
  }

  private _createShaderLoader(): ShaderLoaderElements {
    const root = document.createElement("div");
    root.className = "hfp-shader-loader";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-label", "Preparing scene transitions");
    root.setAttribute("data-hyperframes-ignore", "");
    root.draggable = false;

    const blockOverlayInteraction = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const eventName of [
      "selectstart",
      "dragstart",
      "pointerdown",
      "mousedown",
      "click",
      "dblclick",
      "contextmenu",
      "touchstart",
    ]) {
      root.addEventListener(eventName, blockOverlayInteraction, { capture: true });
    }

    const panel = document.createElement("div");
    panel.className = "hfp-shader-loader-panel";
    panel.draggable = false;

    const markFrame = document.createElement("div");
    markFrame.className = "hfp-shader-loader-mark";
    markFrame.draggable = false;
    markFrame.innerHTML = [
      '<svg width="78" height="78" viewBox="0 0 100 100" fill="none" aria-hidden="true" draggable="false">',
      '<path d="M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z" fill="url(#hfp-shader-loader-grad-left)"/>',
      '<path d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z" fill="url(#hfp-shader-loader-grad-right)"/>',
      "<defs>",
      '<linearGradient id="hfp-shader-loader-grad-left" x1="48.5676" y1="25" x2="44.7804" y2="71.9384" gradientUnits="userSpaceOnUse">',
      '<stop stop-color="#06E3FA"/>',
      '<stop offset="1" stop-color="#4FDB5E"/>',
      "</linearGradient>",
      '<linearGradient id="hfp-shader-loader-grad-right" x1="54.8282" y1="73.8392" x2="72.0989" y2="32.8932" gradientUnits="userSpaceOnUse">',
      '<stop stop-color="#06E3FA"/>',
      '<stop offset="1" stop-color="#4FDB5E"/>',
      "</linearGradient>",
      "</defs>",
      "</svg>",
    ].join("");

    const title = document.createElement("div");
    title.className = "hfp-shader-loader-title";
    const titleText = document.createElement("span");
    titleText.className = "hfp-shader-loader-title-text";
    titleText.textContent = SHADER_LOADING_PHRASES[0] || "Preparing scene transitions";
    title.appendChild(titleText);

    const detail = document.createElement("div");
    detail.className = "hfp-shader-loader-detail";
    detail.textContent = "Rendering animated scene samples for shader transitions.";

    const track = document.createElement("div");
    track.className = "hfp-shader-loader-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("div");
    fill.className = "hfp-shader-loader-fill";
    track.appendChild(fill);

    const progress = document.createElement("div");
    progress.className = "hfp-shader-loader-progress";
    const createProgressRow = (labelText: string) => {
      const row = document.createElement("div");
      row.className = "hfp-shader-loader-row";
      const label = document.createElement("span");
      label.className = "hfp-shader-loader-label";
      label.textContent = labelText;
      const value = document.createElement("span");
      value.className = "hfp-shader-loader-value";
      row.appendChild(label);
      row.appendChild(value);
      progress.appendChild(row);
      return { row, label, value };
    };
    const transitionStatus = createProgressRow("transition");
    const frameStatus = createProgressRow("transition frame");

    panel.appendChild(markFrame);
    panel.appendChild(title);
    panel.appendChild(detail);
    panel.appendChild(track);
    panel.appendChild(progress);
    root.appendChild(panel);

    return {
      root,
      fill,
      title: titleText,
      detail,
      transitionValue: transitionStatus.value,
      frameLabel: frameStatus.label,
      frameValue: frameStatus.value,
      frameRow: frameStatus.row,
    };
  }

  private _showShaderLoader(): void {
    if (this.shaderLoaderHideTimeout) {
      clearTimeout(this.shaderLoaderHideTimeout);
      this.shaderLoaderHideTimeout = null;
    }
    this.shaderLoaderEl.classList.remove("hfp-hiding");
    this.shaderLoaderEl.classList.add("hfp-visible");
  }

  private _hideShaderLoader(): void {
    if (this.shaderLoaderEl.classList.contains("hfp-hiding")) {
      if (!this.shaderLoaderHideTimeout) this._scheduleShaderLoaderHideCleanup();
      return;
    }
    if (!this.shaderLoaderEl.classList.contains("hfp-visible")) return;
    this.shaderLoaderEl.classList.add("hfp-hiding");
    this.shaderLoaderEl.classList.remove("hfp-visible");
    this._scheduleShaderLoaderHideCleanup();
  }

  private _scheduleShaderLoaderHideCleanup(): void {
    if (this.shaderLoaderHideTimeout) clearTimeout(this.shaderLoaderHideTimeout);
    this.shaderLoaderHideTimeout = setTimeout(() => {
      this.shaderLoaderEl.classList.remove("hfp-hiding");
      this.shaderLoaderHideTimeout = null;
    }, 420);
  }

  private _resetShaderLoader(): void {
    if (this.shaderLoaderHideTimeout) {
      clearTimeout(this.shaderLoaderHideTimeout);
      this.shaderLoaderHideTimeout = null;
    }
    this.shaderLoaderEl.classList.remove("hfp-visible", "hfp-hiding");
    this.shaderLoaderFillEl.style.transform = "scaleX(0)";
    this.shaderLoaderTransitionValueEl.textContent = "";
    this.shaderLoaderFrameValueEl.textContent = "";
    this.shaderLoaderFrameRowEl.style.visibility = "hidden";
  }

  private _updateShaderLoader(status: ShaderTransitionState): void {
    if (this._shaderLoadingMode() !== "player") {
      this._resetShaderLoader();
      return;
    }
    if (status.ready || !status.loading) {
      this._hideShaderLoader();
      return;
    }

    const progress =
      typeof status.progress === "number" && Number.isFinite(status.progress) ? status.progress : 0;
    const total =
      typeof status.total === "number" && Number.isFinite(status.total) ? status.total : 0;
    const ratio = total > 0 ? Math.min(1, Math.max(0, progress / total)) : 0;
    const phraseIndex = Math.min(
      SHADER_LOADING_PHRASES.length - 1,
      Math.floor(ratio * SHADER_LOADING_PHRASES.length),
    );
    this.shaderLoaderTitleEl.textContent =
      SHADER_LOADING_PHRASES[phraseIndex] || "Preparing scene transitions";
    this.shaderLoaderDetailEl.textContent =
      status.phase === "cached"
        ? "Loading cached transition frames before playback."
        : status.phase === "finalizing"
          ? "Uploading transition textures for smooth playback."
          : "Rendering animated scene samples for shader transitions.";
    this.shaderLoaderFillEl.style.transform = `scaleX(${ratio})`;

    this.shaderLoaderTransitionValueEl.textContent =
      status.currentTransition !== undefined && status.transitionTotal !== undefined
        ? `${status.currentTransition}/${status.transitionTotal}`
        : total > 0
          ? `${progress}/${total}`
          : "";

    const frameValue =
      status.transitionFrame !== undefined && status.transitionFrames !== undefined
        ? `${status.transitionFrame}/${status.transitionFrames}`
        : "";
    this.shaderLoaderFrameLabelEl.textContent =
      status.phase === "cached"
        ? "cached transition frames"
        : status.phase === "finalizing"
          ? "finalizing transition frames"
          : "rendering transition frames";
    this.shaderLoaderFrameValueEl.textContent = frameValue;
    this.shaderLoaderFrameRowEl.style.visibility = frameValue ? "visible" : "hidden";
    this.shaderLoaderEl.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    this._showShaderLoader();
  }

  /**
   * Reach into the runtime's `window.__player.seek` directly, skipping the
   * postMessage hop. Same-origin only — cross-origin embeds throw a
   * `SecurityError` on `contentWindow` property access, which we catch and
   * report as a no-op so the caller can transparently fall back to the
   * postMessage bridge. Returns `true` only when the runtime accepted the
   * call (`__player.seek` exists, is callable, and didn't throw).
   *
   * Studio has used this access path privately via `iframe.contentWindow.__player`
   * (see `useTimelinePlayer.ts`); this helper just formalizes the same
   * detection inside the player so external scrub UIs get the same
   * single-task latency. The runtime-side `seek` is the same wrapped
   * function the postMessage handler calls (`installRuntimeControlBridge`
   * routes through `player.seek`), so `markExplicitSeek()` and downstream
   * runtime state stay identical between the two paths.
   */
  private _trySyncSeek(timeInSeconds: number): boolean {
    try {
      const win = this.iframe.contentWindow as
        | (Window & { __player?: { seek?: (t: number) => void } })
        | null;
      const player = win?.__player;
      const seek = player?.seek;
      if (typeof seek !== "function") return false;
      seek.call(player, timeInSeconds);
      return true;
    } catch {
      return false;
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

    if (data.type === "shader-transition-state") {
      const state: ShaderTransitionState =
        data.state && typeof data.state === "object" ? data.state : {};
      this._updateShaderLoader(state);
      this.dispatchEvent(
        new CustomEvent("shadertransitionstate", {
          detail: { compositionId: data.compositionId, state },
        }),
      );
      return;
    }

    if (data.type === "state") {
      this._currentTime = (data.frame ?? 0) / DEFAULT_FPS;
      const wasPlaying = !this._paused;
      const nextPaused = !data.isPlaying;
      const completedPlayback =
        this._duration > 0 && this._currentTime >= this._duration && (wasPlaying || data.isPlaying);

      if (completedPlayback && this.loop) {
        if (this._audioOwner === "parent") this._pauseParentMedia();
        this._paused = nextPaused;
        this.seek(0);
        this.play();
        return;
      }

      this._paused = nextPaused;

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

      if (completedPlayback) {
        if (this._audioOwner === "parent") this._pauseParentMedia();
        this._paused = true;
        this.controlsApi?.updatePlaying(false);
        this.dispatchEvent(new Event("ended"));
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
    this._resetShaderLoader();
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

  /**
   * How many *consecutive* over-threshold steady-state samples we wait for
   * before issuing a `currentTime` write. A value of 2 means a single
   * spike (one slow bridge tick, one tab-throttled rAF batch, one GC pause)
   * is absorbed without a seek; sustained drift still corrects on the very
   * next tick after the threshold is crossed twice in a row.
   *
   * **Coupling with the timeline-control bridge** — read before changing:
   *   worst_case_correction_latency_ms
   *     ≈ MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES × bridgeMaxPostIntervalMs
   *
   * `bridgeMaxPostIntervalMs` (currently `80`) lives at
   * `packages/core/src/runtime/state.ts` (field on `RuntimeState`). At
   * today's values, worst-case is `2 × 80 ms = 160 ms` — still well under
   * the human shot-change tolerance for A/V re-sync. If you bump bridge
   * cadence (raising `bridgeMaxPostIntervalMs`) you may need to drop this
   * constant to `1` to keep the product under ~150 ms; if you tighten
   * cadence you can raise this to absorb more jitter without perceptual
   * cost. There is a back-reference in `state.ts` next to
   * `bridgeMaxPostIntervalMs` so a change to either side surfaces the
   * coupling.
   */
  private static readonly MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES = 2;

  /**
   * Mirror parent-proxy `currentTime` to the iframe timeline. Defaults to
   * the *coalesced* path: a single over-threshold sample is treated as
   * jitter and merely increments a per-proxy counter; the actual seek only
   * fires once `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES` consecutive
   * samples agree. Pass `{ force: true }` for one-shot alignment moments
   * (audio-ownership promotion, brand-new proxy initialization) where we
   * cannot tolerate even ~80 ms of misaligned audible playback.
   *
   * The counter is also reset on any in-threshold sample and on any
   * out-of-range timeline position, so a proxy that drops back into a
   * scene later starts fresh rather than carrying stale samples from the
   * last time it was active.
   */
  private _mirrorParentMediaTime(timelineSeconds: number, options?: { force?: boolean }) {
    const force = options?.force === true;
    const requiredSamples = HyperframesPlayer.MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES;
    const threshold = HyperframesPlayer.MIRROR_DRIFT_THRESHOLD_SECONDS;
    for (const m of this._parentMedia) {
      const relTime = timelineSeconds - m.start;
      if (relTime < 0 || relTime >= m.duration) {
        m.driftSamples = 0;
        continue;
      }
      if (Math.abs(m.el.currentTime - relTime) > threshold) {
        m.driftSamples += 1;
        if (force || m.driftSamples >= requiredSamples) {
          m.el.currentTime = relTime;
          m.driftSamples = 0;
        }
      } else {
        m.driftSamples = 0;
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
    // One-shot alignment: a brand-new proxy must pick up the iframe's exact
    // timeline position immediately to avoid an audible jump. Bypass the
    // jitter-coalescing gate.
    this._mirrorParentMediaTime(this._currentTime, { force: true });
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
  ): { el: HTMLMediaElement; start: number; duration: number; driftSamples: number } | null {
    // Deduplicate — browsers normalize URLs so we compare on the element after assignment
    if (this._parentMedia.some((m) => m.el.src === src)) return null;

    const el = tag === "video" ? document.createElement("video") : new Audio();
    el.preload = "auto";
    el.src = src;
    el.load();
    el.muted = this.muted;
    if (this.playbackRate !== 1) el.playbackRate = this.playbackRate;

    const entry = { el, start, duration, driftSamples: 0 };
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
      // One-shot alignment: a freshly-created proxy must catch up to the
      // current timeline position on the very first sample, so bypass the
      // jitter-coalescing gate.
      this._mirrorParentMediaTime(this._currentTime, { force: true });
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
    const hosts = doc.querySelectorAll("[data-composition-id]");
    if (hosts.length > 0) {
      for (const host of hosts) {
        obs.observe(host, { childList: true, subtree: true });
      }
    } else {
      obs.observe(doc.body, { childList: true, subtree: true });
    }
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
