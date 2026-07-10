/**
 * Probes an iframe document to discover the composition's playback adapter
 * and detect whether the HyperFrames runtime needs to be injected.
 *
 * The probe interval polls every 200 ms until one of:
 *   - A `PlaybackDurationAdapter` resolves with a positive duration, or
 *   - 40 attempts (~8 s) expire without a result.
 *
 * The `CompositionProbe` class owns the interval; the caller must call
 * `stop()` on disconnect or src change.
 */

import { needsPreParseRuntime, injectRuntimeIntoHtml } from "./runtime-injection.js";
import { shouldInjectRuntime } from "./shouldInjectRuntime.js";
import {
  type DirectTimelineAdapter,
  type PlaybackDurationAdapter,
  buildAnimeDirectTimelineAdapter,
  isAnimeRegistryLike,
  isDirectTimelineAdapter,
  isObjectRecord,
  isRuntimeDurationAdapter,
} from "./timeline-adapters.js";

const RUNTIME_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";

export interface ProbeResult {
  duration: number;
  adapter: PlaybackDurationAdapter;
  /** Resolved composition dimensions, if present in the document. */
  compositionSize: { width: number; height: number } | null;
}

export interface ProbeCallbacks {
  onReady: (result: ProbeResult) => void;
  onError: (message: string) => void;
  /** Called when runtime is successfully injected (informational). */
  onRuntimeInjected?: () => void;
  /**
   * Returns the runtime URL to use in place of the published CDN default —
   * backs the `runtime-src` element attribute. Return a falsy value to keep
   * the default.
   */
  getRuntimeUrl?: () => string | null | undefined;
}

/**
 * Parse a composition dimension, rejecting anything that isn't a positive
 * finite number. Exported because the `width`/`height` attribute handlers in
 * hyperframes-player.ts need the same guard: dimensions feed
 * scaleIframeToFit's `w / compositionWidth` division, where NaN produces an
 * invalid `scale(NaN)` transform and zero a division by zero — both render
 * the player blank with no signal.
 */
export function readPositiveDimension(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readCompositionSizeFromDocument(
  doc: Document | null | undefined,
): { width: number; height: number } | null {
  const root =
    doc?.querySelector("[data-composition-id][data-width][data-height]") ??
    doc?.querySelector("[data-width][data-height]");
  if (!root) return null;
  const width = readPositiveDimension(root.getAttribute("data-width"));
  const height = readPositiveDimension(root.getAttribute("data-height"));
  return width !== null && height !== null ? { width, height } : null;
}

export class CompositionProbe {
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _runtimeInjected = false;
  /**
   * The `src` value pre-parse injection has already been attempted for, or
   * `null` before any attempt. Deliberately NOT reset by `start()`: our own
   * `srcdoc` reload (see `_injectRuntimePreParse`) calls `start()` again with
   * the original `src` attribute still in place, and re-attempting would loop
   * forever. A genuinely new `src` naturally compares unequal and is free to
   * try again.
   */
  private _preParseAttemptedSrc: string | null = null;

  constructor(
    private readonly _iframe: HTMLIFrameElement,
    private readonly _callbacks: ProbeCallbacks,
  ) {}

  // fallow-ignore-next-line unused-class-member
  get runtimeInjected(): boolean {
    return this._runtimeInjected;
  }

  /** Start (or restart) the probe. Stops any previously running probe first. */
  start(): void {
    this.stop();
    this._runtimeInjected = false;
    let attempts = 0;

    // fallow-ignore-next-line complexity
    this._interval = setInterval(() => {
      attempts++;
      try {
        const win = this._iframe.contentWindow as Window & {
          __player?: { getDuration: () => number };
          __timelines?: Record<string, { duration: () => number }>;
          __hf?: unknown;
          hyperframesAnime?: unknown;
          __hfAnime?: unknown;
        };
        if (!win) return;

        const hasRuntime = !!(win.__hf || win.__player);
        const hasTimelines = !!(win.__timelines && Object.keys(win.__timelines).length > 0);
        const hasAnimeRegistrations =
          isAnimeRegistryLike(win.hyperframesAnime) || isAnimeRegistryLike(win.__hfAnime);
        const hasNestedCompositions =
          !!this._iframe.contentDocument?.querySelector("[data-composition-src]");

        if (this._maybeInjectPreParseRuntime(hasRuntime, hasTimelines, hasAnimeRegistrations)) {
          return;
        }

        if (
          shouldInjectRuntime({
            hasRuntime,
            hasTimelines,
            hasNestedCompositions,
            hasAnimeRegistrations,
            runtimeInjected: this._runtimeInjected,
            attempts,
          })
        ) {
          this._injectRuntime();
          return;
        }

        if (this._runtimeInjected && !hasRuntime) return;

        const adapter = this._resolvePlaybackDurationAdapter(win);
        if (adapter && adapter.getDuration() > 0) {
          this.stop();

          const compositionSize = readCompositionSizeFromDocument(this._iframe.contentDocument);

          this._callbacks.onReady({
            duration: adapter.getDuration(),
            adapter,
            compositionSize,
          });
          return;
        }
      } catch {
        /* cross-origin */
      }

      if (attempts >= 40) {
        this.stop();
        this._callbacks.onError("Composition timeline not found after 8s");
      }
    }, 200);
  }

  stop(): void {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  // ── Adapter resolution (same-origin only) ────────────────────────────────

  resolveDirectTimelineAdapter(): DirectTimelineAdapter | null {
    try {
      const win = this._iframe.contentWindow;
      if (!win) return null;
      return this._resolveDirectTimelineAdapterFromWindow(win);
    } catch {
      return null;
    }
  }

  resolveDirectTimelineAdapterFromWindow(win: Window): DirectTimelineAdapter | null {
    return this._resolveDirectTimelineAdapterFromWindow(win);
  }

  hasRuntimeBridge(win: Window): boolean {
    return Reflect.get(win, "__hf") !== undefined || isObjectRecord(Reflect.get(win, "__player"));
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Resolves against the *parent* page's location (not the composition's),
   * matching how the `runtime-src`/`src` attributes are authored on
   * `<hyperframes-player>` itself. This matters most for pre-parse injection:
   * the rewritten HTML gets its own `<base>` pointing at the composition's
   * directory, so an unresolved relative runtime URL would otherwise be
   * silently reinterpreted against the wrong base once embedded.
   */
  private _runtimeUrl(): string {
    const raw = this._callbacks.getRuntimeUrl?.() || RUNTIME_CDN_URL;
    try {
      return new URL(raw, this._iframe.ownerDocument?.baseURI ?? location.href).toString();
    } catch {
      return raw;
    }
  }

  private _injectRuntime(): void {
    this._runtimeInjected = true;
    try {
      const doc = this._iframe.contentDocument;
      if (!doc) return;
      const script = doc.createElement("script");
      script.src = this._runtimeUrl();
      (doc.head || doc.documentElement).appendChild(script);
      this._callbacks.onRuntimeInjected?.();
    } catch {
      /* cross-origin — can't inject */
    }
  }

  /**
   * Same-origin standalone anime compositions need the runtime installed
   * *before* their own inline scripts run (see runtime-injection.ts for why).
   * When `needsPreParseRuntime` says so, fetch the original `src`, rewrite it,
   * and reload the iframe from the rewritten copy via `srcdoc`.
   *
   * Returns true when this tick was consumed by (starting) that attempt, so
   * the caller skips the rest of its normal decision-making for this tick.
   */
  private _maybeInjectPreParseRuntime(
    hasRuntime: boolean,
    hasTimelines: boolean,
    hasAnimeRegistrations: boolean,
  ): boolean {
    const src = this._iframe.getAttribute("src");
    if (!src) return false;

    const shouldInject = needsPreParseRuntime({
      hasRuntime,
      hasTimelines,
      hasAnimeRegistrations,
      referencesHyperframesAnime: this._docReferencesHyperframesAnime(),
      alreadyAttempted: src === this._preParseAttemptedSrc,
    });
    if (!shouldInject) return false;

    this._preParseAttemptedSrc = src;
    void this._injectRuntimePreParse(src);
    return true;
  }

  private _docReferencesHyperframesAnime(): boolean {
    const doc = this._iframe.contentDocument;
    if (!doc) return false;
    for (const script of doc.querySelectorAll("script:not([src])")) {
      if (script.textContent?.includes("hyperframesAnime")) return true;
    }
    return false;
  }

  /**
   * Fetches `src`, injects the runtime `<script>` (plus a `<base>` so
   * relative assets keep resolving) ahead of the composition's own scripts,
   * and reloads the iframe from the rewritten HTML via `srcdoc`. On any
   * failure (network, CORS, non-2xx) this is a no-op: the normal polling
   * loop continues and eventually surfaces the existing 8s `onError` timeout.
   */
  private async _injectRuntimePreParse(src: string): Promise<void> {
    try {
      const resolvedUrl = new URL(src, this._iframe.ownerDocument?.baseURI ?? location.href);
      const response = await fetch(resolvedUrl.toString());
      if (!response.ok) throw new Error(`fetch failed with status ${response.status}`);
      const html = await response.text();
      const baseHref = new URL(".", resolvedUrl).toString();
      this._iframe.srcdoc = injectRuntimeIntoHtml(html, this._runtimeUrl(), baseHref);
      this._callbacks.onRuntimeInjected?.();
    } catch {
      /* fetch/CORS failure — fall back to the existing onError timeout path */
    }
  }

  private _resolveDirectTimelineAdapterFromWindow(win: Window): DirectTimelineAdapter | null {
    if (this.hasRuntimeBridge(win)) return null;

    const rootId = this._readRootCompositionId();

    const timelines = Reflect.get(win, "__timelines");
    if (isObjectRecord(timelines)) {
      const keys = Object.keys(timelines);
      if (keys.length > 0) {
        const key = rootId && rootId in timelines ? rootId : keys[keys.length - 1];
        const timeline = timelines[key];
        if (isDirectTimelineAdapter(timeline)) return timeline;
      }
    }

    return (
      buildAnimeDirectTimelineAdapter(Reflect.get(win, "hyperframesAnime"), rootId) ??
      buildAnimeDirectTimelineAdapter(Reflect.get(win, "__hfAnime"), rootId)
    );
  }

  private _readRootCompositionId(): string | null {
    try {
      return (
        this._iframe.contentDocument
          ?.querySelector("[data-composition-id]")
          ?.getAttribute("data-composition-id") ?? null
      );
    } catch {
      return null;
    }
  }

  private _resolvePlaybackDurationAdapter(win: Window): PlaybackDurationAdapter | null {
    const runtimePlayer = Reflect.get(win, "__player");
    if (isRuntimeDurationAdapter(runtimePlayer)) {
      return { kind: "runtime", getDuration: () => runtimePlayer.getDuration() };
    }

    const timeline = this._resolveDirectTimelineAdapterFromWindow(win);
    if (timeline) {
      return {
        kind: "direct-timeline",
        timeline,
        getDuration: () => timeline.duration(),
      };
    }

    return null;
  }
}
