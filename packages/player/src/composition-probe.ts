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

import { shouldInjectRuntime } from "./shouldInjectRuntime.js";
import {
  type DirectTimelineAdapter,
  type PlaybackDurationAdapter,
  isDirectTimelineAdapter,
  isObjectRecord,
  isRuntimeDurationAdapter,
} from "./timeline-adapters.js";

import { RUNTIME_CDN_URL, runtimeCdnUrlForVersion } from "./runtime-url.js";

export { runtimeCdnUrlForVersion };

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
   * Where to load the runtime from when the probe has to inject it. Read at
   * injection time, not at construction, so a `runtime-src` set after the
   * element was created is still honoured. Defaults to the pinned CDN build.
   */
  resolveRuntimeUrl?: () => string;
}

/**
 * Whether the core runtime has installed its player bridge in this window.
 *
 * The bridge is `window.__player`: the runtime creates it synchronously during
 * init, in the same task as `window.__hf`, and it is the only global the
 * player ever drives. `window.__hf` on its own is not evidence of a runtime:
 * it is a shared namespace that `@hyperframes/shader-transitions` also creates
 * (`window.__hf = window.__hf || {}`) to publish `shaderTransitionsReady`, so
 * an authored composition using shader transitions carries `__hf` with no
 * runtime behind it. Treating that as "runtime present" meant the probe never
 * injected the runtime and refused the direct-timeline adapter, and the embed
 * timed out after 8 s with a black frame.
 */
function hasRuntimeBridge(win: Window): boolean {
  return isObjectRecord(Reflect.get(win, "__player"));
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
          __timelines?: Record<string, { duration: () => number }>;
        };
        if (!win) return;

        const hasRuntime = hasRuntimeBridge(win);
        const hasTimelines = !!(win.__timelines && Object.keys(win.__timelines).length > 0);
        const hasNestedCompositions =
          !!this._iframe.contentDocument?.querySelector("[data-composition-src]");

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

  // fallow-ignore-next-line unused-class-member
  resolveDirectTimelineAdapterFromWindow(win: Window): DirectTimelineAdapter | null {
    return this._resolveDirectTimelineAdapterFromWindow(win);
  }

  hasRuntimeBridge(win: Window): boolean {
    return hasRuntimeBridge(win);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _injectRuntime(): void {
    this._runtimeInjected = true;
    try {
      const doc = this._iframe.contentDocument;
      if (!doc) return;
      const runtimeUrl = this._callbacks.resolveRuntimeUrl?.() ?? RUNTIME_CDN_URL;
      const script = doc.createElement("script");
      script.src = runtimeUrl;
      // A runtime that is blocked (CSP, offline, 404) used to look exactly like
      // a slow one: the probe kept polling and reported a missing timeline 8 s
      // later. Fail on the script's own error instead, naming the URL.
      script.onerror = () => {
        if (this._interval === null) return;
        this.stop();
        this._callbacks.onError(`HyperFrames runtime failed to load from ${runtimeUrl}`);
      };
      (doc.head || doc.documentElement).appendChild(script);
      this._callbacks.onRuntimeInjected?.();
    } catch {
      /* cross-origin — can't inject */
    }
  }

  private _resolveDirectTimelineAdapterFromWindow(win: Window): DirectTimelineAdapter | null {
    if (hasRuntimeBridge(win)) return null;

    const timelines = Reflect.get(win, "__timelines");
    if (!isObjectRecord(timelines)) return null;

    const keys = Object.keys(timelines);
    if (keys.length === 0) return null;

    const rootId = this._iframe.contentDocument
      ?.querySelector("[data-composition-id]")
      ?.getAttribute("data-composition-id");
    const key = rootId && rootId in timelines ? rootId : keys[keys.length - 1];
    const timeline = timelines[key];
    return isDirectTimelineAdapter(timeline) ? timeline : null;
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
