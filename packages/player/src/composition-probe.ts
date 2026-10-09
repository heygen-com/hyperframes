/**
 * Probes an iframe document to discover the composition's playback adapter
 * and detect whether the HyperFrames runtime needs to be injected.
 *
 * The probe interval polls every 200 ms until one of:
 *   - An adapter or the document resolves with a positive duration, or
 *   - 40 attempts (~8 s) expire without a result.
 *
 * The `CompositionProbe` class owns the interval; the caller must call
 * `stop()` on disconnect or src change.
 */

import { readStaticCompositionMeta } from "@hyperframes/core/runtime/composition-length";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
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
  resolveRuntimeUrl?: () => string;
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

type ProbeOutcome =
  | { kind: "ready"; result: ProbeResult }
  | { kind: "error"; message: string }
  | null;

function firstAuthorError(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  return (
    errors.find(
      (value): value is string =>
        typeof value === "string" && value.trim() !== "" && value !== "[object Event]",
    ) ?? null
  );
}

export class CompositionProbe {
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _runtimeInjected = false;
  private _runtimeScript: HTMLScriptElement | null = null;
  private _failure: { document: Document | null } | null = null;

  get failed(): boolean {
    return this._failure !== null && this._failure.document === this._iframe.contentDocument;
  }

  constructor(
    private readonly _iframe: HTMLIFrameElement,
    private readonly _callbacks: ProbeCallbacks,
  ) {}

  // fallow-ignore-next-line unused-class-member
  get runtimeInjected(): boolean {
    return this._runtimeInjected;
  }

  /** Start or restart the probe, stopping the active interval first. */
  start(): void {
    this.stop();
    this._failure = null;
    this._runtimeInjected = false;
    let attempts = 0;

    this._interval = setInterval(() => {
      attempts++;
      let outcome: ProbeOutcome = null;
      try {
        outcome = this._poll(attempts);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "SecurityError")) {
          outcome = {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (outcome) {
        this.stop();
        if (outcome.kind === "error") {
          this._failure = { document: this._iframe.contentDocument };
          this._callbacks.onError(outcome.message);
        } else this._callbacks.onReady(outcome.result);
        return;
      }
      if (attempts >= 40) {
        this.stop();
        this._failure = { document: this._iframe.contentDocument };
        this._callbacks.onError("Composition timeline not found after 8s");
      }
    }, 200);
  }

  private _poll(attempts: number): ProbeOutcome {
    const win = this._iframe.contentWindow;
    if (!win) return null;
    const message = firstAuthorError(Reflect.get(win, STUDIO_PREVIEW_ERRORS));
    if (message !== null) return { kind: "error", message };
    const doc = this._iframe.contentDocument;
    const timelines = Reflect.get(win, "__timelines");
    const hasRuntime = this.hasRuntimeBridge(win);
    if (
      shouldInjectRuntime({
        hasRuntime,
        hasTimelines: isObjectRecord(timelines) && Object.keys(timelines).length > 0,
        hasNestedCompositions: !!doc?.querySelector("[data-composition-src]"),
        runtimeInjected: this._runtimeInjected,
        attempts,
      })
    ) {
      this._injectRuntime();
      return null;
    }
    if (this._runtimeInjected && !hasRuntime) return null;
    const result = this._resolveReadyResult(win, doc);
    return result ? { kind: "ready", result } : null;
  }

  private _resolveReadyResult(win: Window, doc: Document | null): ProbeResult | null {
    const adapter: PlaybackDurationAdapter = this._resolvePlaybackDurationAdapter(win) ?? {
      kind: "document",
      getDuration: () => 0,
    };
    let duration = adapter.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      if (adapter.kind === "direct-timeline") return null;
      duration = doc ? (readStaticCompositionMeta(doc)?.durationSeconds ?? 0) : 0;
    }
    if (duration <= 0) return null;
    return {
      duration,
      adapter: { ...adapter, getDuration: () => duration },
      compositionSize: readCompositionSizeFromDocument(doc),
    };
  }

  stop(): void {
    if (this._runtimeScript) {
      this._runtimeScript.onerror = null;
      this._runtimeScript = null;
    }
    if (!this.failed) this._failure = null;
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
    return isObjectRecord(Reflect.get(win, "__player"));
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _injectRuntime(): void {
    this._runtimeInjected = true;
    try {
      const doc = this._iframe.contentDocument;
      if (!doc) return;
      const script = doc.createElement("script");
      script.src = this._callbacks.resolveRuntimeUrl?.() ?? RUNTIME_CDN_URL;
      this._runtimeScript = script;
      script.onerror = () => {
        if (this._runtimeScript !== script || this._iframe.contentDocument !== doc) return;
        this.stop();
        this._failure = { document: doc };
        this._callbacks.onError("HyperFrames runtime failed to load from " + script.src);
      };
      (doc.head || doc.documentElement).appendChild(script);
      this._callbacks.onRuntimeInjected?.();
    } catch {
      /* cross-origin — can't inject */
    }
  }

  private _resolveDirectTimelineAdapterFromWindow(win: Window): DirectTimelineAdapter | null {
    if (this.hasRuntimeBridge(win)) return null;

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
