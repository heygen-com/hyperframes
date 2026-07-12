import {
  parseSlideshowManifest,
  resolveSlideshow,
  type ResolvedSlideshow,
} from "@hyperframes/core/slideshow";
import { SlideshowController, type PlayerPort } from "./SlideshowController";
import {
  SlideshowChannel,
  buildPresenterLayout,
  formatElapsed,
  type PresenterMediaAction,
  type PresenterMediaMessage,
} from "./slideshowPresenter";

interface Hotspot {
  id: string;
  label: string;
  target: string;
  region?: { x: number; y: number; w: number; h: number };
}

interface ControllerLike {
  next(): void;
  prev(): void;
  onChange(cb: () => void): () => void;
  readonly counter: { index: number; total: number };
  readonly breadcrumb: { id: string; label: string }[];
  readonly currentSlide: { hotspots: Hotspot[]; notes?: string; sceneId?: string } | undefined;
  readonly nextSlide: { sceneId: string; notes?: string } | null;
  readonly position: { sequenceId: string; slideIndex: number; fragmentIndex: number };
  readonly canPrev?: boolean;
  readonly canNext?: boolean;
  goToSlide?(index: number): void;
  syncTo?(sequenceId: string, slideIndex: number, fragmentIndex: number): void;
  enterBranch?(id: string): void;
  back?(): void;
  backToMain?(): void;
  dispose?(): void;
}

interface SlideNotesTarget {
  sceneId?: string;
}

type SlideshowManifest = NonNullable<ReturnType<typeof parseSlideshowManifest>>;

// Autoplay re-assert poll (see playSceneDocumentMedia): the player drives clips
// during bootstrap and on enter, so a single play() loses the race; we poll
// briefly until the clip is advancing.
const AUTOPLAY_STEP_MS = 150;
const AUTOPLAY_MAX_MS = 6000;
interface AutoplayPollState {
  started: boolean;
  lastTime: number;
  advancingTicks: number;
  waited: number;
  warned: boolean;
}

type PlayerElement = HTMLElement & {
  seek(t: number): void;
  play(): void;
  pause(): void;
  stopMedia?(): void;
  muted?: boolean;
  readonly iframeElement?: HTMLIFrameElement;
  readonly currentTime: number;
  readonly ready: boolean;
};

type SlideshowMediaElement = HTMLMediaElement & {
  dataset: DOMStringMap;
};

/** True when the keydown originated in a text-entry control (typing must never
 *  navigate the deck). Duck-typed so it works for events from the composition
 *  iframe's realm, where instanceof this realm's element classes always fails. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function isPlayerElement(el: HTMLElement): el is PlayerElement {
  return (
    typeof (el as PlayerElement).seek === "function" &&
    typeof (el as PlayerElement).play === "function" &&
    typeof (el as PlayerElement).pause === "function"
  );
}

const PRESENTER_NOTES_STORAGE_PREFIX = "hf-slideshow:presenter-notes:v1:";

// Injected once per document to avoid duplicating @keyframes across multiple elements.
let _keyframesInjected = false;
function injectKeyframesOnce(): void {
  if (_keyframesInjected) return;
  _keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes hf-hotspot-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.35), 0 4px 16px rgba(0,0,0,0.35); }
      50%       { box-shadow: 0 0 0 8px rgba(255,255,255,0), 0 4px 20px rgba(0,0,0,0.45); }
    }
    @keyframes hf-nav-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .hf-hotspot-pill,
      .hf-nav-spinner { animation: none !important; }
    }
    /* Nav-button hover (replaces inline onmouseover/onmouseout — CSP-safe).
       !important beats the inline base color set on each button. */
    [data-hf-nav-cluster] button:hover {
      background: rgba(255,255,255,0.12) !important;
      color: #fff !important;
    }
    [data-hf-nav-cluster] button[data-hf-tooltip] {
      position: relative;
    }
    [data-hf-nav-cluster] button[data-hf-tooltip]::before,
    [data-hf-nav-cluster] button[data-hf-tooltip]::after {
      position: absolute;
      left: 50%;
      opacity: 0;
      pointer-events: none;
      transform: translateX(-50%) translateY(3px);
      transition: opacity 0.12s ease, transform 0.12s ease;
      z-index: 20;
    }
    [data-hf-nav-cluster] button[data-hf-tooltip]::before {
      content: "";
      bottom: calc(100% + 4px);
      border: 5px solid transparent;
      border-top-color: rgba(12,12,14,0.95);
    }
    [data-hf-nav-cluster] button[data-hf-tooltip]::after {
      content: attr(data-hf-tooltip);
      bottom: calc(100% + 14px);
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(12,12,14,0.95);
      color: #fff;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1;
      white-space: nowrap;
    }
    [data-hf-nav-cluster] button[data-hf-tooltip]:hover::before,
    [data-hf-nav-cluster] button[data-hf-tooltip]:hover::after,
    [data-hf-nav-cluster] button[data-hf-tooltip]:focus-visible::before,
    [data-hf-nav-cluster] button[data-hf-tooltip]:focus-visible::after {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    /* When muted, the speaker button stays dimmed on hover so the mute-state
       affordance isn't erased (higher specificity than the rule above). */
    [data-hf-muted] [data-hf-mute]:hover {
      color: rgba(255,255,255,0.6) !important;
    }
  `;
  document.head.appendChild(style);
}

// Fullscreen glyphs (enter = expand corners, exit = collapse corners). Module-level
// so onFsChange can swap just this glyph without re-rendering the whole chrome.
const ENTER_FS_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
const EXIT_FS_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
const PRESENT_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M10 8.5v4l4-2-4-2z"/></svg>`;
const COUNTER_FONT_FAMILY =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export class HyperframesSlideshow extends HTMLElement {
  private controller: ControllerLike | null = null;
  private offChange: (() => void) | null = null;
  private chrome: HTMLDivElement | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private channel: SlideshowChannel | null = null;
  private presenterStartMs: number | null = null;
  private presenterInterval: ReturnType<typeof setInterval> | null = null;
  private presenterPositionTimers: ReturnType<typeof setTimeout>[] = [];
  private disconnected = false;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initInFlight = false;
  private initGeneration = 0;
  private keyForwardFrame: HTMLIFrameElement | null = null;
  private detachIframeKeys: (() => void) | null = null;
  private warnedIframeKeyForwardingUnavailable = false;
  private _muted = false;
  private mediaWireInterval: ReturnType<typeof setInterval> | null = null;
  private playerObserver: MutationObserver | null = null;
  private applyingRemoteMedia = false;
  private lastMediaTimeBroadcastMs = 0;
  private audienceMutedPlaybackKeys = new Set<string>();
  private blockedAudienceMedia = new Map<string, PresenterMediaMessage>();
  private audienceMediaUnlockButton: HTMLButtonElement | null = null;
  // Bumped whenever autoplay starts or media is stopped (slide change), so a
  // pending re-assert from a previous autoplay can't replay a clip we've left.
  private autoplayToken = 0;

  /** Whether audio is currently muted. Reflects `data-hf-muted` attribute. */
  get muted(): boolean {
    return this._muted;
  }

  /** Mode resolves from the `mode` attribute, falling back to the URL query
   *  (?mode=audience) so the audience tab opened by present() is detected. */
  private resolveMode(): string | null {
    const attr = this.getAttribute("mode");
    if (attr) return attr;
    try {
      return new URLSearchParams(location.search).get("mode");
    } catch {
      return null;
    }
  }

  // Observe the attributes the component reads so runtime toggles take effect.
  static get observedAttributes(): string[] {
    return ["sound", "mode"];
  }

  attributeChangedCallback(): void {
    // Re-render once bound so a flipped `sound`/`mode` is reflected (mute button,
    // audience-vs-presenter chrome). No-op before the controller binds.
    if (this.controller) this.render();
  }

  connectedCallback(): void {
    this.disconnected = false;
    this.initInFlight = false;
    this.initGeneration += 1;
    this.tabIndex = 0;
    // Keydowns with focus inside the player iframe don't reach this window
    // listener — attachIframeKeyForwarding() (wired in init) covers that path.
    window.addEventListener("keydown", this.onKey);
    this.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.addEventListener("touchend", this.onTouchEnd);
    window.addEventListener("message", this.onMessage);
    document.addEventListener("fullscreenchange", this.onFsChange);
    this.initChannel();
    this.observeInteractivePlayers();
    // Defer player-dependent init to a macrotask so that child elements are
    // parsed before we query for <hyperframes-player>. This matters when the
    // bundle is loaded synchronously (e.g. <script src> in <head>), where
    // connectedCallback fires while the parser is still inside the
    // <hyperframes-slideshow> open tag — before its children exist. A microtask
    // is NOT sufficient: during streamed parsing the children are appended in a
    // later task, so a queued microtask still observes an empty subtree. A
    // setTimeout(0) macrotask yields to the parser so the children land first.
    this.initTimer = setTimeout(() => {
      this.initTimer = null;
      if (this.isConnected && !this.disconnected) {
        this.ensureInteractivePlayers();
        void this.init();
      }
    }, 0);
  }

  disconnectedCallback(): void {
    this.disconnected = true;
    this.initGeneration += 1;
    this.autoplayToken++; // cancel any in-flight autoplay re-assert loop
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    window.removeEventListener("keydown", this.onKey);
    this.detachIframeKeys?.();
    this.removeEventListener("touchstart", this.onTouchStart);
    this.removeEventListener("touchend", this.onTouchEnd);
    window.removeEventListener("message", this.onMessage);
    document.removeEventListener("fullscreenchange", this.onFsChange);
    this.offChange?.();
    this.offChange = null;
    this.controller?.dispose?.();
    this.controller = null;
    this.chrome = null;
    this.channel?.destroy();
    this.channel = null;
    if (this.mediaWireInterval !== null) {
      clearInterval(this.mediaWireInterval);
      this.mediaWireInterval = null;
    }
    if (this.playerObserver !== null) {
      this.playerObserver.disconnect();
      this.playerObserver = null;
    }
    this.audienceMediaUnlockButton?.remove();
    this.audienceMediaUnlockButton = null;
    this.audienceMutedPlaybackKeys.clear();
    this.blockedAudienceMedia.clear();
    if (this.presenterInterval !== null) {
      clearInterval(this.presenterInterval);
      this.presenterInterval = null;
    }
    this.clearPresenterPositionTimers();
  }

  /** Test seam: inject a controller without a live player. */
  __setControllerForTest(c: ControllerLike): void {
    this.bindController(c);
  }

  /**
   * Opens an audience tab and switches this element to presenter layout.
   * Audience tab URL: current page URL with `mode=audience` query param.
   */
  present(): void {
    if (this.resolveMode() === "audience" || this.getAttribute("data-hf-presenting") === "true") {
      return;
    }
    // URL API, not string concat: with a #fragment in the page URL, appending
    // "?mode=audience" would land inside the fragment and the opened tab would
    // boot as an unsynced second presenter.
    const url = new URL(location.href);
    url.searchParams.set("mode", "audience");
    // Anchor click, not window.open(features): rel="noopener noreferrer" severs
    // opener at creation time while Chrome still opens a regular tab. Passing a
    // non-empty features string tends to create a popup WINDOW, which freezes
    // when fully covered during screen share.
    if (!this.openAudienceTab(url.href)) {
      console.warn("[hyperframes-slideshow] present(): browser blocked the audience tab");
      return;
    }
    this.setAttribute("data-hf-presenting", "true");
    this.postCurrentPresenterPositionBurst();
    this.presenterStartMs = Date.now();
    if (this.presenterInterval === null) {
      this.presenterInterval = setInterval(() => this.updateElapsed(), 1000);
    }
    this.render();
  }

  private openAudienceTab(href: string): boolean {
    const userActivation = (navigator as Navigator & { userActivation?: { isActive?: boolean } })
      .userActivation;
    if (userActivation && userActivation.isActive === false) return false;

    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    (document.body ?? document.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  /**
   * Update only the elapsed readout. Re-rendering the whole chrome every second
   * (the old behavior) rebuilt the nav buttons' DOM on each tick — they
   * flickered and clicks landing mid-rebuild were dropped.
   */
  private updateElapsed(): void {
    if (this.presenterStartMs === null) return;
    const el = this.chrome?.querySelector("[data-hf-presenter-elapsed]");
    if (el) {
      el.textContent = formatElapsed(Math.floor((Date.now() - this.presenterStartMs) / 1000));
    }
  }

  private initChannel(): void {
    const mode = this.resolveMode();
    if (mode === "audience") {
      this.channel = new SlideshowChannel(
        "audience",
        (msg) => {
          if (!this.controller) return;
          this.controller.syncTo?.(msg.sequenceId, msg.slideIndex, msg.fragmentIndex);
        },
        this.onRemoteMedia,
      );
    } else {
      this.channel = new SlideshowChannel(
        "presenter",
        () => {
          // presenter channel does not receive goto messages; posting happens in bindController.
        },
        this.onRemoteMedia,
      );
    }
  }

  // fallow-ignore-next-line complexity
  private async init(): Promise<void> {
    if (this.initInFlight) return;
    this.initInFlight = true;
    const gen = this.initGeneration;

    try {
      const playerEl = this.querySelector("hyperframes-player");
      if (!playerEl || !(playerEl instanceof HTMLElement)) return;

      const html = this.innerHTML;
      let manifest: ReturnType<typeof parseSlideshowManifest>;
      try {
        manifest = parseSlideshowManifest(html);
      } catch {
        // Malformed island (e.g. bad JSON) — fail gracefully, no chrome.
        return;
      }
      if (!manifest) return;

      this.renderInitialChrome(manifest);

      if (!isPlayerElement(playerEl)) return;

      await waitForReady(playerEl);

      // Guard: if a disconnect or reconnect happened while waiting, bail out.
      if (gen !== this.initGeneration) return;

      this.attachIframeKeyForwarding(playerEl);

      // Wait for scenes to be populated (the runtime "timeline" postMessage
      // arrives ~1000ms after waitForReady resolves). Graceful fallback to []
      // on timeout so explicit startTime/endTime slides still work.
      const scenes = await waitForScenes(playerEl, 2500, () => gen !== this.initGeneration);

      // Guard again in case we were disconnected or reconnected during the scenes wait.
      if (gen !== this.initGeneration) return;

      const { resolved, errors } = resolveSlideshow(manifest, scenes);
      if (errors.length > 0) {
        console.warn("[hyperframes-slideshow] manifest errors:", errors);
      }
      const cleaned = dropInvalidSlides(resolved);
      if (cleaned.slides.length === 0 && manifest.slides.length > 0) {
        console.error(
          "[hyperframes-slideshow] no main-line slides resolved — the scene timeline may not have loaded in time, or sceneIds/timing are invalid:",
          errors,
        );
      }

      const port: PlayerPort = {
        seek: (t) => playerEl.seek(t),
        play: () => playerEl.play(),
        pause: () => playerEl.pause(),
        stopMedia: () => {
          playerEl.stopMedia?.();
          this.stopDocumentMedia();
        },
        playSceneMedia: (sceneId) => this.playSceneDocumentMedia(sceneId),
        get currentTime() {
          return playerEl.currentTime;
        },
        onTimeUpdate: (cb) => {
          const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ currentTime: number }>).detail;
            cb(detail.currentTime);
          };
          playerEl.addEventListener("timeupdate", handler);
          return () => playerEl.removeEventListener("timeupdate", handler);
        },
      };

      this.bindController(new SlideshowController(port, cleaned));

      // Slow-iframe recovery: if the scene timeline hadn't posted yet (empty
      // scenes → sceneId-based slides were dropped), re-init once when it finally
      // arrives so those slides resolve instead of being permanently lost.
      if (scenes.length === 0 && manifest.slides.length > 0) {
        playerEl.addEventListener(
          "scenes",
          () => {
            if (gen === this.initGeneration) void this.init();
          },
          { once: true },
        );
      }
    } finally {
      this.initInFlight = false;
    }
  }

  private renderInitialChrome(manifest: SlideshowManifest): void {
    if (this.controller || manifest.slides.length === 0) return;
    const counter = { index: 1, total: manifest.slides.length };
    if (this.resolveMode() === "audience") {
      this.paintChrome(this.buildNavCluster(counter, "28px", "fs-only"));
      return;
    }
    this.paintChrome(
      this.buildNavCluster(counter, "28px", "full", {
        canPrev: false,
        canNext: manifest.slides.length > 1,
        loading: manifest.slides.length > 1,
      }),
    );
  }

  private bindController(c: ControllerLike): void {
    this.offChange?.();
    this.controller?.dispose?.();
    this.controller = c;
    this.startMediaSync();
    this.offChange = c.onChange(() => {
      // Presenter posts position to channel on every change
      if (this.resolveMode() !== "audience" && this.channel) {
        this.channel.postPosition(c.position);
      }
      this.render();
    });
    // Post initial position if presenter
    if (this.resolveMode() !== "audience" && this.channel) {
      this.channel.postPosition(c.position);
    }
    this.render();
  }

  private postCurrentPresenterPosition(): void {
    if (this.resolveMode() === "audience" || !this.channel || !this.controller) return;
    this.channel.postPosition(this.controller.position);
  }

  private postCurrentPresenterPositionBurst(): void {
    this.clearPresenterPositionTimers();
    this.postCurrentPresenterPosition();
    for (const delay of [250, 750, 1500, 3000, 5000]) {
      const timer = setTimeout(() => {
        this.presenterPositionTimers = this.presenterPositionTimers.filter(
          (item) => item !== timer,
        );
        this.postCurrentPresenterPosition();
      }, delay);
      this.presenterPositionTimers.push(timer);
    }
  }

  private clearPresenterPositionTimers(): void {
    for (const timer of this.presenterPositionTimers) {
      clearTimeout(timer);
    }
    this.presenterPositionTimers = [];
  }

  private startMediaSync(): void {
    this.wireSlideshowMedia();
    if (this.mediaWireInterval === null) {
      // Same-origin player iframes can hydrate media after the slideshow binds.
      // The dataset guard prevents duplicate listeners, and removed iframe nodes
      // are collectable because this component keeps no media element references.
      this.mediaWireInterval = setInterval(() => this.wireSlideshowMedia(), 1000);
    }
  }

  private mediaPlayerElements(): (Partial<PlayerElement> & HTMLElement)[] {
    return Array.from(this.querySelectorAll("hyperframes-player")).filter(
      (player): player is Partial<PlayerElement> & HTMLElement => player instanceof HTMLElement,
    );
  }

  /**
   * Inner `<hyperframes-player>` instances inside a slideshow need the
   * `interactive` attribute so clickable controls, links, native media
   * controls, and custom players inside the composition iframe receive
   * pointer events (the player's default is `pointer-events: none`).
   *
   * Set it mechanically so authors / agents don't have to remember.
   * Idempotent: if the host already declared `interactive` (any value,
   * including `interactive="false"`), it is preserved.
   */
  private ensureInteractivePlayers(): void {
    for (const player of this.querySelectorAll("hyperframes-player")) {
      if (!player.hasAttribute("interactive")) {
        player.setAttribute("interactive", "");
      }
    }
  }

  /**
   * Watch for `<hyperframes-player>` children added after the initial mount
   * (dynamic templating, hydration, drag-drop authoring) and apply the
   * `interactive` attribute to those too.
   */
  private observeInteractivePlayers(): void {
    if (typeof MutationObserver === "undefined") return;
    if (this.playerObserver !== null) return;
    this.playerObserver = new MutationObserver(() => this.ensureInteractivePlayers());
    this.playerObserver.observe(this, { childList: true, subtree: true });
  }

  /**
   * Forward keydown events from the composition iframe to onKey. Interactive
   * decks move focus into the iframe when the presenter clicks a slide, and
   * top-window keydown stops firing — without this, arrow keys stop controlling
   * the deck after any in-slide click. Same-origin frames only (cross-origin
   * access throws → warn once and leave top-window shortcuts working).
   * Re-attached on every iframe `load`,
   * because a navigation clears listeners the parent added to the content
   * window.
   */
  private attachIframeKeyForwarding(player: Partial<PlayerElement> & HTMLElement): void {
    const frame = player.iframeElement;
    if (!(frame instanceof HTMLIFrameElement) || frame === this.keyForwardFrame) return;
    this.detachIframeKeys?.();
    const attach = (): void => {
      try {
        // addEventListener dedupes same handler+target, so re-runs are safe.
        frame.contentWindow?.addEventListener("keydown", this.onKey);
      } catch {
        this.warnIframeKeyForwardingUnavailable();
      }
    };
    attach();
    frame.addEventListener("load", attach);
    this.keyForwardFrame = frame;
    this.detachIframeKeys = (): void => {
      frame.removeEventListener("load", attach);
      try {
        frame.contentWindow?.removeEventListener("keydown", this.onKey);
      } catch {
        this.warnIframeKeyForwardingUnavailable();
      }
      this.keyForwardFrame = null;
      this.detachIframeKeys = null;
    };
  }

  private warnIframeKeyForwardingUnavailable(): void {
    if (this.warnedIframeKeyForwardingUnavailable) return;
    this.warnedIframeKeyForwardingUnavailable = true;
    console.warn(
      "[hyperframes-slideshow] iframe keyboard forwarding is unavailable for this composition, likely because the player iframe is cross-origin. Arrow shortcuts work when focus is outside the iframe.",
    );
  }

  private playerFrameDocument(player: Partial<PlayerElement> & HTMLElement): Document | null {
    const frame = player.iframeElement;
    if (!(frame instanceof HTMLIFrameElement)) return null;
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  }

  private mediaKey(
    player: HTMLElement,
    playerIndex: number,
    media: SlideshowMediaElement,
    mediaIndex: number,
  ): string {
    const playerKey = player.id ? `player-id:${player.id}` : `player:${playerIndex}`;
    const mediaKey = media.id ? `id:${media.id}` : `${media.tagName.toLowerCase()}:${mediaIndex}`;
    return `${playerKey}|${mediaKey}`;
  }

  private mediaEntries(): { key: string; el: SlideshowMediaElement }[] {
    const entries: { key: string; el: SlideshowMediaElement }[] = [];
    this.mediaPlayerElements().forEach((player, playerIndex) => {
      const doc = this.playerFrameDocument(player);
      if (!doc) return;
      Array.from(doc.querySelectorAll("video,audio"))
        .filter(isSlideshowMediaElement)
        .forEach((el, mediaIndex) => {
          entries.push({ key: this.mediaKey(player, playerIndex, el, mediaIndex), el });
        });
    });
    return entries;
  }

  private wireSlideshowMedia(): void {
    const actions: PresenterMediaAction[] = [
      "play",
      "pause",
      "seeking",
      "seeked",
      "ratechange",
      "volumechange",
      "ended",
      "timeupdate",
    ];
    for (const { key, el } of this.mediaEntries()) {
      if (el.dataset.hfSlideshowMediaSync === "1") continue;
      el.dataset.hfSlideshowMediaSync = "1";
      for (const action of actions) {
        el.addEventListener(action, () => this.publishMediaState(el, key, action));
      }
    }
  }

  private publishMediaState(
    el: SlideshowMediaElement,
    key: string,
    action: PresenterMediaAction,
  ): void {
    if (this.applyingRemoteMedia || this.resolveMode() === "audience" || !this.channel) return;
    if (action === "timeupdate") {
      const now = performance.now();
      if (now - this.lastMediaTimeBroadcastMs < 450 && !el.paused) return;
      this.lastMediaTimeBroadcastMs = now;
    }
    this.channel.postMedia({
      key,
      action,
      currentTime: finiteMediaNumber(el.currentTime, 0),
      paused: el.paused,
      ended: el.ended,
      muted: el.muted,
      volume: finiteMediaNumber(el.volume, 1),
      playbackRate: finiteMediaNumber(el.playbackRate, 1),
    });
  }

  private onRemoteMedia = (msg: PresenterMediaMessage): void => {
    if (this.resolveMode() !== "audience") return;
    if (this.blockedAudienceMedia.has(msg.key) && msg.action === "timeupdate") {
      this.blockedAudienceMedia.set(msg.key, msg);
      this.showAudienceMediaUnlock();
      return;
    }
    this.wireSlideshowMedia();
    const entry = this.mediaEntries().find((candidate) => candidate.key === msg.key);
    if (!entry) return;
    this.applyingRemoteMedia = true;
    try {
      this.applyRemoteMedia(entry.el, msg);
    } finally {
      setTimeout(() => {
        this.applyingRemoteMedia = false;
      }, 300);
    }
  };

  private applyRemoteMedia(el: SlideshowMediaElement, msg: PresenterMediaMessage): void {
    if (msg.action === "pause" || msg.action === "ended") {
      this.audienceMutedPlaybackKeys.delete(msg.key);
      this.blockedAudienceMedia.delete(msg.key);
      this.syncRemoteMediaState(el, msg, true);
      el.pause();
      this.hideAudienceMediaUnlockIfClear();
      return;
    }

    const remoteWantsPlayback =
      msg.action === "play" || (msg.action === "timeupdate" && msg.paused === false && el.paused);
    if (remoteWantsPlayback) {
      this.playAudienceMediaMuted(el, msg);
      return;
    }

    this.syncRemoteMediaState(el, msg, true);
  }

  private syncRemoteMediaState(
    el: SlideshowMediaElement,
    msg: PresenterMediaMessage,
    allowTimeSync: boolean,
  ): void {
    el.playbackRate = finiteMediaNumber(msg.playbackRate, 1);
    el.volume = Math.max(0, Math.min(1, finiteMediaNumber(msg.volume, 1)));
    el.muted = this.audienceMutedPlaybackKeys.has(msg.key) ? true : msg.muted;
    if (
      allowTimeSync &&
      Number.isFinite(msg.currentTime) &&
      Math.abs((el.currentTime || 0) - msg.currentTime) > 0.35
    ) {
      el.currentTime = Math.max(0, msg.currentTime);
    }
  }

  private playAudienceMediaMuted(el: SlideshowMediaElement, msg: PresenterMediaMessage): void {
    this.audienceMutedPlaybackKeys.add(msg.key);
    this.syncRemoteMediaState(el, msg, true);
    el.muted = true;
    try {
      void el
        .play()
        .then(() => {
          this.blockedAudienceMedia.delete(msg.key);
          this.hideAudienceMediaUnlockIfClear();
        })
        .catch(() => {
          this.blockedAudienceMedia.set(msg.key, msg);
          this.showAudienceMediaUnlock();
        });
    } catch {
      this.blockedAudienceMedia.set(msg.key, msg);
      this.showAudienceMediaUnlock();
    }
  }

  private retryBlockedAudienceMedia = (): void => {
    this.wireSlideshowMedia();
    const entries = new Map(this.mediaEntries().map((entry) => [entry.key, entry.el]));
    for (const [key, msg] of this.blockedAudienceMedia) {
      const el = entries.get(key);
      if (el) this.playAudienceMediaMuted(el, msg);
    }
  };

  private showAudienceMediaUnlock(): void {
    if (this.resolveMode() !== "audience" || this.audienceMediaUnlockButton) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Play audience media muted";
    button.style.cssText =
      "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:100000;border:0;border-radius:999px;padding:12px 18px;background:#fff;color:#111827;box-shadow:0 10px 32px rgba(0,0,0,.28);font:700 14px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;";
    button.addEventListener("click", this.retryBlockedAudienceMedia);
    this.appendChild(button);
    this.audienceMediaUnlockButton = button;
  }

  private hideAudienceMediaUnlockIfClear(): void {
    if (this.blockedAudienceMedia.size > 0 || !this.audienceMediaUnlockButton) return;
    this.audienceMediaUnlockButton.remove();
    this.audienceMediaUnlockButton = null;
  }

  // fallow-ignore-next-line complexity
  private onKey = (e: KeyboardEvent): void => {
    // Duck-typed (not instanceof): this handler also receives keydowns forwarded
    // from the composition iframe, whose elements are instances of the IFRAME
    // realm's classes — instanceof against this realm's would never match.
    if (isTextEntryTarget(e.target)) return;
    const active = document.activeElement;
    // With focus inside the composition iframe, the top document's activeElement
    // is the <iframe> itself — contained by this element, so `focused` stays true
    // and arrows keep driving the deck after the presenter clicks into the slide.
    const focused = active === this || this.contains(active);
    // Arrows act even when nothing is focused (active === body/null) so a freshly
    // loaded deck responds without a click; Space/Backspace have strong page-level
    // defaults (scroll / history) so they only act when the deck actually has focus.
    // When several decks share a page, drop the unfocused-convenience so a key
    // doesn't drive every instance at once — only the focused deck responds.
    const multiInstance = document.querySelectorAll("hyperframes-slideshow").length > 1;
    const ambient = focused || (!multiInstance && (active === document.body || active === null));
    // P is handled BEFORE the controller guard: present() doesn't need the
    // controller, and on a slow-loading deck the advertised shortcut must work
    // immediately rather than silently doing nothing until the controller binds.
    if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!ambient || !this.shouldShowPresentControl()) return;
      this.present();
      e.preventDefault();
      return;
    }
    if (!this.controller) return;
    if (e.key === "ArrowRight") {
      if (!ambient) return;
      this.controller.next();
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      if (!ambient) return;
      this.controller.prev();
      e.preventDefault();
    } else if (e.key === " ") {
      if (!focused) return;
      this.controller.next();
      e.preventDefault();
    } else if (e.key === "Backspace") {
      if (!focused) return;
      this.controller.prev();
      e.preventDefault();
    } else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!focused) return;
      this.toggleFullscreen();
      e.preventDefault();
    }
  };

  // fallow-ignore-next-line complexity
  private onMessage = (e: MessageEvent): void => {
    // Audience mode is driven by BroadcastChannel; ignore embed postMessage nav.
    if (this.resolveMode() === "audience") return;
    const data = e.data as { type?: unknown; slideIndex?: unknown } | null;
    if (!data || !this.controller) return;
    if (data.type === "next") {
      this.controller.next();
    } else if (data.type === "prev") {
      this.controller.prev();
    } else if (data.type === "goto" && typeof data.slideIndex === "number") {
      this.controller.goToSlide?.(data.slideIndex);
    } else if (data.type === "back") {
      this.controller.back?.();
    }
  };

  private onTouchStart = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (touch) {
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (!this.controller) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;
    // Require a dominant horizontal gesture: |deltaX| > 40 AND |deltaX| > |deltaY|
    // so that diagonal page-scrolls do not accidentally trigger slide navigation.
    if (Math.abs(deltaX) <= 40 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (deltaX < 0) {
      this.controller.next();
    } else {
      this.controller.prev();
    }
  };

  // fallow-ignore-next-line complexity
  private render(): void {
    if (!this.controller) return;

    if (this.resolveMode() === "audience") {
      // Audience (viewer) window: no nav controls — but keep a fullscreen toggle
      // so the presentation can fill the display.
      const { counter } = this.controller;
      this.paintChrome(this.buildNavCluster(counter, "28px", "fs-only"));
      return;
    }

    if (this.getAttribute("data-hf-presenting") === "true") {
      this.renderPresenter();
      return;
    }

    const { counter, currentSlide } = this.controller;
    if (!currentSlide) return;

    // Hotspot pills: compact floating buttons anchored to the region's top-left,
    // sized to content (not filling the region). The region x/y positions the pill;
    // w/h are ignored for sizing (pill is content-sized). XSS: escHtml guards all
    // user-supplied strings.
    const hotspotsHtml = currentSlide.hotspots
      .map((h) => {
        const posStyle = h.region
          ? `left:${h.region.x}%;top:${h.region.y}%;`
          : "right:5%;bottom:18%;";
        return `<button
          class="hf-hotspot-pill"
          data-hotspot-id="${escHtml(h.id)}"
          data-hotspot-target="${escHtml(h.target)}"
          type="button"
          style="position:absolute;${posStyle}display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--hf-slideshow-accent,rgba(255,255,255,0.92));color:#111;border:none;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:0.01em;cursor:pointer;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,0.35);animation:hf-hotspot-pulse 1.8s ease-in-out infinite;white-space:nowrap;"
          aria-label="${escHtml(h.label)}"
        ><span aria-hidden="true" style="font-size:14px;line-height:1;">⊕</span>${escHtml(h.label)}</button>`;
      })
      .join("");

    this.paintChrome(hotspotsHtml + this.buildNavCluster(counter, "28px"));
  }

  /** Ensure the overlay chrome layer exists, set its content, and wire its buttons. */
  private paintChrome(html: string): void {
    injectKeyframesOnce(); // nav-button :hover + hotspot keyframes (CSP-safe, once per doc)
    if (!this.chrome) {
      this.chrome = document.createElement("div");
      this.chrome.setAttribute("data-hf-chrome", "");
      this.appendChild(this.chrome);
    }
    this.chrome.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:10;";
    this.chrome.innerHTML = html;
    this.wireChromeButtons();
  }

  // Builds the nav cluster ([mute?] [prev] counter [next] | [present?] [fullscreen]) as a
  // floating capsule. `bottomCss` positions it (normal view: "28px"; presenter
  // view: above the notes panel). Reused by render() and renderPresenter().
  // fallow-ignore-next-line complexity
  private buildNavCluster(
    counter: { index: number; total: number },
    bottomCss: string,
    variant: "full" | "fs-only" = "full",
    options: { canPrev?: boolean; canNext?: boolean; loading?: boolean } = {},
  ): string {
    const c = this.controller;
    const showPrev = options.canPrev ?? c?.canPrev ?? true;
    const showNext = options.canNext ?? c?.canNext ?? true;
    const showLoading = options.loading === true && showNext;
    const showSound = this.hasAttribute("sound");
    const btnStyle =
      "display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;border:none;border-radius:999px;color:rgba(255,255,255,0.85);font-size:16px;cursor:pointer;transition:background 0.15s,color 0.15s;padding:0;";
    const speakerSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const speakerMutedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    const muteBtnHtml = showSound
      ? `<button
          data-hf-mute
          type="button"
          aria-label="${this._muted ? "Unmute" : "Mute"}"
          title="${this._muted ? "Unmute" : "Mute"}"
          data-hf-tooltip="${this._muted ? "Unmute" : "Mute"}"
          aria-pressed="${this._muted ? "true" : "false"}"
          style="${btnStyle}${this._muted ? "color:rgba(255,255,255,0.45);" : ""}"
        >${this._muted ? speakerMutedSvg : speakerSvg}</button>`
      : "";
    const prevBtnHtml = showPrev
      ? `<button
          data-hf-prev
          type="button"
          aria-label="Previous slide"
          title="Previous slide"
          data-hf-tooltip="Previous slide"
          style="${btnStyle}"        >&#8249;</button>`
      : "";
    const loadingHtml = showLoading
      ? `<span
          data-hf-nav-loading
          role="status"
          aria-label="Loading slides"
          title="Loading slides"
          style="${btnStyle}cursor:progress;color:rgba(255,255,255,0.72);"
        ><span class="hf-nav-spinner" aria-hidden="true" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.32);border-top-color:rgba(255,255,255,0.92);border-radius:999px;animation:hf-nav-spin 0.8s linear infinite;"></span></span>`
      : "";
    const nextBtnHtml = showLoading
      ? loadingHtml
      : showNext
        ? `<button
          data-hf-next
          type="button"
          aria-label="Next slide"
          title="Next slide"
          data-hf-tooltip="Next slide"
          style="${btnStyle}"        >&#8250;</button>`
        : "";
    const presentBtnHtml = this.shouldShowPresentControl()
      ? `<button
          data-hf-present
          type="button"
          aria-label="Present"
          title="Present"
          data-hf-tooltip="Present"
          style="${btnStyle}"        >${PRESENT_SVG}</button>`
      : "";
    const isFs = document.fullscreenElement === this;
    const fsLabel = isFs ? "Exit full screen" : "Full screen";
    const fsBtnHtml = `<button
          data-hf-fullscreen
          type="button"
          aria-label="${fsLabel}"
          title="${fsLabel}"
          data-hf-tooltip="${fsLabel}"
          aria-pressed="${isFs ? "true" : "false"}"
          style="${btnStyle}"        >${isFs ? EXIT_FS_SVG : ENTER_FS_SVG}</button>`;
    // Audience/viewer: only the fullscreen control (no navigation).
    if (variant === "fs-only") {
      return `
      <div
        data-hf-nav-cluster
        style="position:absolute;bottom:${bottomCss};right:32px;display:inline-flex;align-items:center;background:rgba(20,20,22,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);border-radius:999px;box-shadow:0 4px 24px rgba(0,0,0,0.45);padding:4px;pointer-events:auto;"
      >${fsBtnHtml}</div>`;
    }
    const counterPadLeft = showPrev ? "4px" : "10px";
    const counterPadRight = showNext ? "4px" : "10px";
    return `
      <div
        data-hf-nav-cluster
        style="position:absolute;bottom:${bottomCss};right:32px;display:inline-flex;align-items:center;gap:2px;background:rgba(20,20,22,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);border-radius:999px;box-shadow:0 4px 24px rgba(0,0,0,0.45);padding:4px;pointer-events:auto;"
      >
        ${muteBtnHtml}
        ${showSound ? `<span aria-hidden="true" style="width:1px;height:20px;background:rgba(255,255,255,0.12);margin:0 2px;flex-shrink:0;"></span>` : ""}
        ${prevBtnHtml}
        <span
          data-hf-counter
          aria-label="Slide ${counter.index} of ${counter.total}"
          style="min-width:46px;text-align:center;color:rgba(255,255,255,0.9);font-family:${COUNTER_FONT_FAMILY};font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:0;padding:0 ${counterPadRight} 0 ${counterPadLeft};user-select:none;"
        >${counter.index}&thinsp;/&thinsp;${counter.total}</span>
        ${nextBtnHtml}
        <span aria-hidden="true" style="width:1px;height:20px;background:rgba(255,255,255,0.12);margin:0 2px;flex-shrink:0;"></span>
        ${presentBtnHtml}
        ${fsBtnHtml}
      </div>`;
  }

  private wireChromeButtons(): void {
    const chrome = this.chrome;
    if (!chrome) return;
    this.wireChromeClick(chrome, "[data-hf-mute]", () => this.toggleMute());
    this.wireChromeClick(chrome, "[data-hf-prev]", () => this.controller?.prev());
    this.wireChromeClick(chrome, "[data-hf-next]", () => this.controller?.next());
    this.wireChromeClick(chrome, "[data-hf-present]", () => this.present());
    this.wireChromeClick(chrome, "[data-hf-fullscreen]", () => this.toggleFullscreen());
    this.wirePresenterNotes(chrome);
    this.wireHotspots(chrome);
  }

  private wireChromeClick(chrome: HTMLDivElement, selector: string, handler: () => void): void {
    const btn = chrome.querySelector(selector);
    if (btn) btn.addEventListener("click", handler);
  }

  private wirePresenterNotes(chrome: HTMLDivElement): void {
    const notesInput = chrome.querySelector("[data-hf-presenter-notes]");
    if (notesInput instanceof HTMLTextAreaElement) {
      const key = notesInput.getAttribute("data-hf-presenter-notes-key");
      notesInput.addEventListener("input", () => this.writePresenterNotes(key, notesInput.value));
    }
  }

  private wireHotspots(chrome: HTMLDivElement): void {
    for (const btn of chrome.querySelectorAll("[data-hotspot-id]")) {
      const target = btn.getAttribute("data-hotspot-target") ?? "";
      btn.addEventListener("click", () => this.controller?.enterBranch?.(target));
    }
  }

  private onFsChange = (): void => {
    // Swap only the fullscreen glyph + label — re-rendering the whole chrome here
    // would rebuild every nav button on each fullscreen toggle.
    const btn = this.chrome?.querySelector("[data-hf-fullscreen]");
    if (!btn) return;
    const isFs = document.fullscreenElement === this;
    btn.innerHTML = isFs ? EXIT_FS_SVG : ENTER_FS_SVG;
    const label = isFs ? "Exit full screen" : "Full screen";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.setAttribute("data-hf-tooltip", label);
    btn.setAttribute("aria-pressed", isFs ? "true" : "false");
  };

  private toggleFullscreen(): void {
    if (document.fullscreenElement === this) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void this.requestFullscreen().catch(() => {});
    }
  }

  private shouldShowPresentControl(): boolean {
    return this.resolveMode() !== "audience" && this.getAttribute("data-hf-presenting") !== "true";
  }

  private toggleMute(): void {
    this._muted = !this._muted;
    if (this._muted) {
      this.setAttribute("data-hf-muted", "");
    } else {
      this.removeAttribute("data-hf-muted");
    }
    this.applyGlobalMute(this._muted);
    this.dispatchEvent(
      new CustomEvent("hf-sound", {
        detail: { muted: this._muted },
        bubbles: true,
        composed: true,
      }),
    );
    // Re-render to flip the glyph.
    this.render();
  }

  private applyGlobalMute(muted: boolean): void {
    for (const player of this.querySelectorAll("hyperframes-player")) {
      if (!(player instanceof HTMLElement)) continue;
      const playerEl = player as Partial<PlayerElement> & HTMLElement;
      if ("muted" in playerEl) {
        playerEl.muted = muted;
      } else if (muted) {
        playerEl.setAttribute("muted", "");
      } else {
        playerEl.removeAttribute("muted");
      }
    }

    const doc = this.ownerDocument;
    for (const el of doc.querySelectorAll("video, audio")) {
      if (el instanceof HTMLMediaElement) el.muted = muted || el.defaultMuted;
    }
  }

  private stopDocumentMedia(): void {
    // Invalidate any in-flight autoplay re-assert so leaving a slide can't be
    // undone by a pending timeout replaying the clip we just paused.
    this.autoplayToken++;
    const doc = this.ownerDocument;
    for (const el of doc.querySelectorAll("video, audio")) {
      if (el instanceof HTMLMediaElement) el.pause();
    }
  }

  /**
   * Play the `<video>` inside a given scene from its start — the runtime side of
   * a slide's `autoplay`. Reaches into the same-origin composition iframe (which
   * is pointer-events:none, so its own controls can't be clicked). The play()
   * fires a "play" event that wireSlideshowMedia() mirrors to any audience
   * window, so this runs on the presenter only — the audience drives its copy
   * from those mirrored events, never on its own.
   *
   * Robust against two timing hazards: (1) the clip may not be in the iframe DOM
   * yet at construction (first slide), and (2) the player drives clips during
   * bootstrap and seeks the timeline on enter — both pause the clip (and reject
   * an in-flight play() with AbortError), so a single play() loses the race. So
   * we poll on a short timer: locate the clip, then assert play() until it is
   * actually advancing across two ticks, then stop — leaving a later real user
   * pause (presenter media controls) alone. A user gesture within the window
   * (real browsers gate autoplay on one) lets the next tick's play() take.
   * Token-guarded, so leaving the slide or disconnecting cancels it.
   */
  private playSceneDocumentMedia(sceneId: string): void {
    if (this.resolveMode() === "audience") return;
    const safeId = sceneId.replace(/["\\]/g, "\\$&");
    const token = ++this.autoplayToken;
    const state: AutoplayPollState = {
      started: false,
      lastTime: -1,
      advancingTicks: 0,
      waited: 0,
      warned: false,
    };
    const tick = (): void => {
      if (token !== this.autoplayToken) return; // left the slide / disconnected
      const done = this.stepAutoplay(safeId, state);
      state.waited += AUTOPLAY_STEP_MS;
      if (!done && state.waited <= AUTOPLAY_MAX_MS) window.setTimeout(tick, AUTOPLAY_STEP_MS);
    };
    tick();
  }

  /** Locate the scene's clip in the composition iframe(s). */
  private findSceneVideo(safeId: string): HTMLVideoElement | null {
    for (const player of this.mediaPlayerElements()) {
      const doc = this.playerFrameDocument(player);
      const video = doc?.querySelector(`[data-composition-id="${safeId}"] video`) ?? null;
      if (video instanceof HTMLVideoElement) return video;
    }
    return null;
  }

  /** One autoplay poll step. Returns true once the clip is confirmed playing. */
  private stepAutoplay(safeId: string, state: AutoplayPollState): boolean {
    const video = this.findSceneVideo(safeId);
    if (!video) return false;
    if (!state.started) {
      state.started = true;
      video.muted = this._muted || video.defaultMuted;
      try {
        video.currentTime = 0;
      } catch {
        // not seekable yet — play from wherever it is
      }
    }
    const advancing = !video.paused && video.currentTime > state.lastTime;
    state.lastTime = video.currentTime;
    if (advancing) return ++state.advancingTicks >= 2; // confirmed playing — stop polling
    state.advancingTicks = 0;
    void video.play().catch((err: unknown) => {
      // Expected during the poll: AbortError (a timeline-sync seek interrupts
      // the play) and NotAllowedError (autoplay gated on a user gesture). Surface
      // anything else once — a real failure (bad src, decode) shouldn't be silent.
      const name = err instanceof DOMException ? err.name : "";
      if (name !== "AbortError" && name !== "NotAllowedError" && !state.warned) {
        state.warned = true;
        console.warn("[hyperframes-slideshow] autoplay play() failed:", err);
      }
    });
    return false;
  }

  private presenterNotesDeckKey(): string {
    const explicit = this.getAttribute("notes-storage-key")?.trim();
    if (explicit) return explicit;

    const playerSrc = this.querySelector("hyperframes-player")?.getAttribute("src") ?? "";
    let resolvedPlayerSrc = playerSrc;
    try {
      const baseHref = typeof location !== "undefined" ? location.href : "http://localhost/";
      resolvedPlayerSrc = new URL(playerSrc, baseHref).href;
    } catch {
      // Keep the raw src when URL construction is unavailable.
    }

    const locationKey =
      typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "";
    const title = this.ownerDocument.title;
    return `${locationKey}|${title}|${resolvedPlayerSrc}`;
  }

  private presenterNotesStorageKey(slide: SlideNotesTarget): string | null {
    const pos = this.controller?.position;
    if (!pos) return null;
    return `${PRESENTER_NOTES_STORAGE_PREFIX}${JSON.stringify([
      this.presenterNotesDeckKey(),
      pos.sequenceId,
      pos.slideIndex,
      slide.sceneId ?? "",
    ])}`;
  }

  private readPresenterNotes(key: string | null): string | null {
    if (!key) return null;
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writePresenterNotes(key: string | null, notes: string): void {
    if (!key) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, notes);
    } catch {
      // localStorage may be disabled or quota-limited; editing still works for
      // the current render even when persistence is unavailable.
    }
  }

  private renderPresenter(): void {
    if (!this.controller) return;
    const { counter, currentSlide, nextSlide } = this.controller;
    if (!currentSlide) return;

    const elapsedSec =
      this.presenterStartMs !== null ? Math.floor((Date.now() - this.presenterStartMs) / 1000) : 0;

    // Pin the live slide to the TOP and reserve the bottom 32% for the notes
    // panel. The player contains the composition, so the FULL slide stays visible
    // (letterboxed) at any width — its bottom is never hidden behind the panel —
    // and it re-fits to the top region on window resize.
    const playerEl = this.querySelector("hyperframes-player");
    if (playerEl instanceof HTMLElement) {
      playerEl.style.top = "0";
      playerEl.style.bottom = "32%";
      playerEl.style.height = "auto";
    }

    // Full-overlay chrome (pointer-events:none); the notes panel and nav cluster
    // are the only interactive children.
    const notesStorageKey = this.presenterNotesStorageKey(currentSlide);
    const notes = this.readPresenterNotes(notesStorageKey) ?? currentSlide.notes ?? "";
    this.paintChrome(
      buildPresenterLayout({
        notes,
        notesStorageKey,
        nextText: nextPanelText(nextSlide),
        counterText: `${counter.index} / ${counter.total}`,
        elapsedText: formatElapsed(elapsedSec),
        hotspots: currentSlide.hotspots,
      }) + this.buildNavCluster(counter, "calc(32% + 18px)"),
    );
  }
}

function nextPanelText(slide: { sceneId: string; notes?: string } | null): string {
  if (slide === null) return "End of sequence";
  const firstLine = slide.notes != null ? (slide.notes.split("\n")[0] ?? "") : "";
  return firstLine.length > 0
    ? `${escHtml(slide.sceneId)}: ${escHtml(firstLine)}`
    : escHtml(slide.sceneId);
}

function isSlideshowMediaElement(el: Element): el is SlideshowMediaElement {
  const win = el.ownerDocument.defaultView;
  if (!win || typeof win.HTMLMediaElement !== "function") return false;
  return el instanceof win.HTMLMediaElement;
}

function finiteMediaNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function readScenes(player: HTMLElement): { id: string; start: number; duration: number }[] {
  if ("scenes" in player && Array.isArray((player as { scenes: unknown }).scenes)) {
    return (player as { scenes: { id: string; start: number; duration: number }[] }).scenes;
  }
  return [];
}

const WAIT_FOR_READY_TIMEOUT_MS = 5000;

function waitForReady(player: HTMLElement & { ready?: boolean }): Promise<void> {
  if (player.ready === true) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve();
    };
    player.addEventListener("ready", handler, { once: true });
    timer = setTimeout(() => {
      player.removeEventListener("ready", handler);
      resolve();
    }, WAIT_FOR_READY_TIMEOUT_MS);
  });
}

/**
 * Polls `player.scenes` until at least one scene is present, then resolves
 * with the scenes array. Resolves with `[]` if no scenes appear within
 * `timeoutMs` (graceful: explicit startTime/endTime slides still work).
 *
 * Avoids Date.now(): counts poll iterations instead (100ms per iteration).
 *
 * `isCancelled` is checked before each poll iteration; if it returns true
 * the promise resolves with `[]` immediately so the caller can bail out.
 */
function waitForScenes(
  player: HTMLElement,
  timeoutMs: number,
  isCancelled: () => boolean = () => false,
): Promise<{ id: string; start: number; duration: number }[]> {
  const initial = readScenes(player);
  if (initial.length > 0) return Promise.resolve(initial);

  const maxIterations = Math.ceil(timeoutMs / 100);

  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let iterations = 0;

    const finish = (val: { id: string; start: number; duration: number }[]): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      player.removeEventListener("scenes", onScenes);
      resolve(val);
    };
    const onScenes = (): void => {
      if (isCancelled()) return finish([]);
      const s = readScenes(player);
      if (s.length > 0) finish(s);
    };
    const poll = (): void => {
      if (done) return;
      if (isCancelled()) return finish([]);
      const cur = readScenes(player);
      if (cur.length > 0) return finish(cur);
      iterations += 1;
      if (iterations >= maxIterations) return finish([]);
      timer = setTimeout(poll, 100);
    };

    player.addEventListener("scenes", onScenes);
    timer = setTimeout(poll, 100);
  });
}

/**
 * Returns a new ResolvedSlideshow with zero-duration (end <= start) slides
 * removed from the main slide list and every sequence's slide list.
 *
 * Valid manifests never produce zero-duration slides — this only drops
 * phantom slides created from partially-specified refs whose scene is absent.
 *
 * Exported as a seam for unit testing.
 */
export function dropInvalidSlides(show: ResolvedSlideshow): ResolvedSlideshow {
  const validSlide = (s: { start: number; end: number }): boolean => s.end > s.start;

  const slides = show.slides.filter(validSlide);

  const sequences: ResolvedSlideshow["sequences"] = {};
  for (const [id, seq] of Object.entries(show.sequences)) {
    sequences[id] = { ...seq, slides: seq.slides.filter(validSlide) };
  }

  return { slides, sequences };
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

if (!customElements.get("hyperframes-slideshow")) {
  customElements.define("hyperframes-slideshow", HyperframesSlideshow);
}
