import {
  parseSlideshowManifest,
  resolveSlideshow,
  type ResolvedSlideshow,
} from "@hyperframes/core/slideshow";
import { SlideshowController, type PlayerPort } from "./SlideshowController";
import { SlideshowChannel, buildPresenterLayout, formatElapsed } from "./slideshowPresenter";

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
  enterBranch?(id: string): void;
  back?(): void;
  backToMain?(): void;
  dispose?(): void;
}

type PlayerElement = HTMLElement & {
  seek(t: number): void;
  play(): void;
  pause(): void;
  readonly currentTime: number;
  readonly ready: boolean;
};

function isPlayerElement(el: HTMLElement): el is PlayerElement {
  return (
    typeof (el as PlayerElement).seek === "function" &&
    typeof (el as PlayerElement).play === "function" &&
    typeof (el as PlayerElement).pause === "function"
  );
}

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
    @media (prefers-reduced-motion: reduce) {
      .hf-hotspot-pill { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

export class HyperframesSlideshow extends HTMLElement {
  private controller: ControllerLike | null = null;
  private offChange: (() => void) | null = null;
  private chrome: HTMLDivElement | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private channel: SlideshowChannel | null = null;
  private presenterStartMs: number | null = null;
  private presenterInterval: ReturnType<typeof setInterval> | null = null;
  private disconnected = false;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initInFlight = false;
  private initGeneration = 0;
  private _muted = false;

  /** Whether audio is currently muted. Reflects `data-hf-muted` attribute. */
  get muted(): boolean {
    return this._muted;
  }

  connectedCallback(): void {
    this.disconnected = false;
    this.initInFlight = false;
    this.initGeneration += 1;
    this.tabIndex = 0;
    // note: if the inner player iframe has keyboard focus, window keydown in the
    // top document won't fire — that edge remains; this listener fixes the dominant
    // case where the page loads and arrows should work without clicking the element.
    window.addEventListener("keydown", this.onKey);
    this.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.addEventListener("touchend", this.onTouchEnd);
    window.addEventListener("message", this.onMessage);
    this.initChannel();
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
      if (this.isConnected && !this.disconnected) void this.init();
    }, 0);
  }

  disconnectedCallback(): void {
    this.disconnected = true;
    this.initGeneration += 1;
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    window.removeEventListener("keydown", this.onKey);
    this.removeEventListener("touchstart", this.onTouchStart);
    this.removeEventListener("touchend", this.onTouchEnd);
    window.removeEventListener("message", this.onMessage);
    this.offChange?.();
    this.offChange = null;
    this.controller?.dispose?.();
    this.controller = null;
    this.chrome = null;
    this.channel?.destroy();
    this.channel = null;
    if (this.presenterInterval !== null) {
      clearInterval(this.presenterInterval);
      this.presenterInterval = null;
    }
  }

  /** Test seam: inject a controller without a live player. */
  __setControllerForTest(c: ControllerLike): void {
    this.bindController(c);
  }

  /**
   * Opens an audience window and switches this element to presenter layout.
   * Audience window URL: current page URL with `mode=audience` query param.
   */
  present(): void {
    const sep = location.search ? "&" : "?";
    window.open(location.href + sep + "mode=audience", "_blank");
    this.setAttribute("data-hf-presenting", "true");
    this.presenterStartMs = Date.now();
    if (this.presenterInterval === null) {
      this.presenterInterval = setInterval(() => this.render(), 1000);
    }
    this.render();
  }

  private initChannel(): void {
    const mode = this.getAttribute("mode");
    if (mode === "audience") {
      this.channel = new SlideshowChannel("audience", (msg) => {
        if (!this.controller) return;
        if (msg.sequenceId !== "main") return; // V1: non-main branch gracefully ignored
        this.controller.goToSlide?.(msg.slideIndex);
      });
    } else {
      this.channel = new SlideshowChannel("presenter", () => {
        // presenter channel does not receive; posting happens in bindController
      });
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
      if (!isPlayerElement(playerEl)) return;

      await waitForReady(playerEl);

      // Guard: if a disconnect or reconnect happened while waiting, bail out.
      if (gen !== this.initGeneration) return;

      const html = this.innerHTML;
      let manifest: ReturnType<typeof parseSlideshowManifest>;
      try {
        manifest = parseSlideshowManifest(html);
      } catch {
        // Malformed island (e.g. bad JSON) — fail gracefully, no chrome.
        return;
      }
      if (!manifest) return;

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

      const port: PlayerPort = {
        seek: (t) => playerEl.seek(t),
        play: () => playerEl.play(),
        pause: () => playerEl.pause(),
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
    } finally {
      this.initInFlight = false;
    }
  }

  private bindController(c: ControllerLike): void {
    this.offChange?.();
    this.controller?.dispose?.();
    this.controller = c;
    this.offChange = c.onChange(() => {
      // Presenter posts position to channel on every change
      if (this.getAttribute("mode") !== "audience" && this.channel) {
        this.channel.postPosition(c.position);
      }
      this.render();
    });
    // Post initial position if presenter
    if (this.getAttribute("mode") !== "audience" && this.channel) {
      this.channel.postPosition(c.position);
    }
    this.render();
  }

  // fallow-ignore-next-line complexity
  private onKey = (e: KeyboardEvent): void => {
    if (!this.controller) return;
    const target = e.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (e.key === "ArrowRight" || e.key === " ") {
      this.controller.next();
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "Backspace") {
      this.controller.prev();
      e.preventDefault();
    }
  };

  // fallow-ignore-next-line complexity
  private onMessage = (e: MessageEvent): void => {
    // Audience mode is driven by BroadcastChannel; ignore embed postMessage nav.
    if (this.getAttribute("mode") === "audience") return;
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

    if (this.getAttribute("data-hf-presenting") === "true") {
      this.renderPresenter();
      return;
    }

    const { counter, currentSlide } = this.controller;
    if (!currentSlide) return;

    if (!this.chrome) {
      this.chrome = document.createElement("div");
      this.chrome.setAttribute("data-hf-chrome", "");
      this.chrome.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:10;";
      this.appendChild(this.chrome);
    }

    // Inject keyframes for hotspot pulse animation once per document.
    injectKeyframesOnce();

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

    // Single cohesive nav cluster: [mute?] [prev |] counter [| next] — bottom-right capsule.
    // Prev/next buttons are hidden when there is no destination in that direction:
    //   - Main deck first slide → no prev (nothing before it)
    //   - Main deck last slide  → no next (nothing after it)
    //   - Inside a branch       → always both (branch-edge returns to parent)
    // The mute toggle is shown only when the `sound` boolean attribute is present.
    const showPrev = this.controller.canPrev !== false;
    const showNext = this.controller.canNext !== false;
    const showSound = this.hasAttribute("sound");
    const btnStyle =
      "display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;border:none;border-radius:999px;color:rgba(255,255,255,0.85);font-size:16px;cursor:pointer;transition:background 0.15s,color 0.15s;padding:0;";
    // Inline SVG glyphs for speaker and speaker-muted (no emoji — consistent across platforms)
    const speakerSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const speakerMutedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    const muteBtnHtml = showSound
      ? `<button
          data-hf-mute
          type="button"
          aria-label="${this._muted ? "Unmute" : "Mute"}"
          aria-pressed="${this._muted ? "true" : "false"}"
          style="${btnStyle}${this._muted ? "color:rgba(255,255,255,0.45);" : ""}"
          onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='${this._muted ? "rgba(255,255,255,0.6)" : "#fff"}';"
          onmouseout="this.style.background='transparent';this.style.color='${this._muted ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)"}';"
        >${this._muted ? speakerMutedSvg : speakerSvg}</button>`
      : "";
    const prevBtnHtml = showPrev
      ? `<button
          data-hf-prev
          type="button"
          aria-label="Previous slide"
          style="${btnStyle}"
          onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='#fff';"
          onmouseout="this.style.background='transparent';this.style.color='rgba(255,255,255,0.85)';"
        >&#8249;</button>`
      : "";
    const nextBtnHtml = showNext
      ? `<button
          data-hf-next
          type="button"
          aria-label="Next slide"
          style="${btnStyle}"
          onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='#fff';"
          onmouseout="this.style.background='transparent';this.style.color='rgba(255,255,255,0.85)';"
        >&#8250;</button>`
      : "";
    // Counter padding adjusts so the pill looks centered when one button is absent.
    const counterPadLeft = showPrev ? "4px" : "10px";
    const counterPadRight = showNext ? "4px" : "10px";
    const navClusterHtml = `
      <div
        data-hf-nav-cluster
        style="position:absolute;bottom:28px;right:32px;display:inline-flex;align-items:center;gap:2px;background:rgba(20,20,22,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);border-radius:999px;box-shadow:0 4px 24px rgba(0,0,0,0.45);padding:4px;pointer-events:auto;"
      >
        ${muteBtnHtml}
        ${showSound ? `<span aria-hidden="true" style="width:1px;height:20px;background:rgba(255,255,255,0.12);margin:0 2px;flex-shrink:0;"></span>` : ""}
        ${prevBtnHtml}
        <span
          data-hf-counter
          aria-label="Slide ${counter.index} of ${counter.total}"
          style="min-width:46px;text-align:center;color:rgba(255,255,255,0.9);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:0.02em;padding:0 ${counterPadRight} 0 ${counterPadLeft};user-select:none;"
        >${counter.index}&thinsp;/&thinsp;${counter.total}</span>
        ${nextBtnHtml}
      </div>
    `;

    this.chrome.innerHTML = hotspotsHtml + navClusterHtml;

    const muteBtn = this.chrome.querySelector("[data-hf-mute]");
    const prevBtn = this.chrome.querySelector("[data-hf-prev]");
    const nextBtn = this.chrome.querySelector("[data-hf-next]");
    if (muteBtn) muteBtn.addEventListener("click", () => this.toggleMute());
    if (prevBtn) prevBtn.addEventListener("click", () => this.controller?.prev());
    if (nextBtn) nextBtn.addEventListener("click", () => this.controller?.next());

    // Wire hotspot clicks after innerHTML is set. Read target from data-hotspot-target
    // so the handler does not close over stale loop state.
    for (const btn of this.chrome.querySelectorAll("[data-hotspot-id]")) {
      const target = btn.getAttribute("data-hotspot-target") ?? "";
      btn.addEventListener("click", () => this.controller?.enterBranch?.(target));
    }
  }

  private toggleMute(): void {
    this._muted = !this._muted;
    if (this._muted) {
      this.setAttribute("data-hf-muted", "");
    } else {
      this.removeAttribute("data-hf-muted");
    }
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

  private renderPresenter(): void {
    if (!this.controller) return;
    const { counter, currentSlide, nextSlide } = this.controller;
    if (!currentSlide) return;

    const elapsedSec =
      this.presenterStartMs !== null ? Math.floor((Date.now() - this.presenterStartMs) / 1000) : 0;

    if (!this.chrome) {
      this.chrome = document.createElement("div");
      this.chrome.setAttribute("data-hf-chrome", "");
      this.chrome.style.cssText = "position:absolute;inset:0;z-index:10;";
      this.appendChild(this.chrome);
    }

    this.chrome.innerHTML = buildPresenterLayout({
      // TODO: live next-slide thumbnail/preview deferred (needs a second seeked player) — V1 shows text
      currentSlideHtml: currentPanelText(currentSlide),
      nextSlideHtml: nextPanelText(nextSlide),
      notes: currentSlide.notes ?? "",
      counterText: `${counter.index} / ${counter.total}`,
      elapsedText: formatElapsed(elapsedSec),
    });
  }
}

function currentPanelText(slide: { notes?: string; sceneId?: string }): string {
  if (slide.notes != null && slide.notes.length > 0) return escHtml(slide.notes);
  if (slide.sceneId != null) return `Current: ${escHtml(slide.sceneId)}`;
  return "";
}

function nextPanelText(slide: { sceneId: string; notes?: string } | null): string {
  if (slide === null) return "End of sequence";
  const firstLine = slide.notes != null ? (slide.notes.split("\n")[0] ?? "") : "";
  return firstLine.length > 0
    ? `${escHtml(slide.sceneId)}: ${escHtml(firstLine)}`
    : escHtml(slide.sceneId);
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
  const scenes = readScenes(player);
  if (scenes.length > 0) return Promise.resolve(scenes);

  const maxIterations = Math.ceil(timeoutMs / 100);

  return new Promise((resolve) => {
    let iterations = 0;
    const poll = (): void => {
      if (isCancelled()) {
        resolve([]);
        return;
      }
      const current = readScenes(player);
      if (current.length > 0) {
        resolve(current);
        return;
      }
      iterations += 1;
      if (iterations >= maxIterations) {
        resolve([]);
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);
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
