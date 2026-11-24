/**
 * Probes an iframe document to discover the composition's playback adapter
 * and detect whether the HyperFrames runtime needs to be injected.
 *
 * The probe interval polls every 200 ms until one of:
 *   - An adapter or the document resolves with a positive duration, or
 *   - this system's `loadLimitMs` passes (reported once; polling goes on), unless the host owns the deadline.
 *
 * The `CompositionProbe` class owns the interval; the caller must call
 * `stop()` on disconnect or src change.
 */

import {
  readCompositionSizeFromDocument,
  readStaticCompositionMeta,
} from "@hyperframes/core/runtime/composition-length";
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

const SEALED_RUNTIME_HINT =
  ". A sealed player adds the HyperFrames runtime only to a composition from its own site: " +
  "include the runtime script in a composition from another site, or play a composition you trust without sandbox-origin.";

export function timelineNotFound(limitMs: number, sealed: boolean): string {
  const message = `Composition timeline not found after ${limitMs / 1000}s`;
  return sealed ? message + SEALED_RUNTIME_HINT : message;
}

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
  hostOwnsDeadline?: () => boolean;
  unreadSealedLoad?: () => boolean;
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

export { readCompositionSizeFromDocument };

const POLL_MS = 200;
const LATE_POLL_MS = 1_000;

type PlatformNavigator = Pick<Navigator, "userAgent"> & { userAgentData?: { platform?: string } };

/** How long a film may load before it counts as failed: about p99 of first frames on that OS, plus 30%. */
export function loadLimitMs(nav: PlatformNavigator = navigator): number {
  const platform = nav.userAgentData?.platform || nav.userAgent;
  if (/Android|CrOS|Chrome OS/i.test(platform)) return 120_000;
  if (/Win/.test(platform)) return 90_000;
  if (/Linux|X11/i.test(platform)) return 30_000;
  return 120_000;
}

type ProbeOutcome =
  | { kind: "ready"; result: ProbeResult }
  | { kind: "error"; message: string }
  | null;

const AUTHOR_ERROR_MAX_LENGTH = 1000;

function firstAuthorError(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  const found = errors.find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "" && value !== "[object Event]",
  );
  return found === undefined ? null : found.slice(0, AUTHOR_ERROR_MAX_LENGTH);
}

export class CompositionProbe {
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _runtimeInjected = false;
  private _runtimeScript: HTMLScriptElement | null = null;
  private _failure: { document: Document | null; deadline: boolean } | null = null;
  private _startedAt = performance.now();
  private _limitMs = loadLimitMs();
  private _navigationPending = false;
  private _timedFromNavigation = false;
  private _preparationTimer: ReturnType<typeof setTimeout> | null = null;
  private _limitReportedBeforeLoad = false;
  private _preparedDocumentUnwritten = false;
  private _frameError: string | null = null;

  get failed(): boolean {
    if (this._failure === null || this._failure.deadline) return false;
    return this._failure.document === this._iframe.contentDocument;
  }

  /** Since the host navigated the frame to this document; null for one the frame opened itself. */
  elapsedMs(): number | null {
    return this._timedFromNavigation ? performance.now() - this._startedAt : null;
  }

  /** The host is navigating the frame: its next document's load is timed from now. */
  markNavigation(): void {
    this._startedAt = performance.now();
    this._limitMs = loadLimitMs();
    this._navigationPending = true;
    this._timedFromNavigation = true;
    this._frameError = null;
    this._endPreparation();
  }

  reportFrameError(value: unknown): void {
    if (this._frameError !== null || (!this._navigationPending && this._interval === null)) return;
    this._frameError = firstAuthorError([value]);
    if (this._frameError !== null && this._interval !== null)
      this._settle({ kind: "error", message: this._frameError });
  }

  markPreparation(): void {
    this.markNavigation();
    this._preparedDocumentUnwritten = true;
    this._preparationTimer = setTimeout(() => this._reportLimitBeforeLoad(), this._limitMs);
  }

  frameWritten(): void {
    this._preparedDocumentUnwritten = false;
  }

  endNavigation(): void {
    this._navigationPending = false;
    this._endPreparation();
  }

  private _endPreparation(): void {
    if (this._preparationTimer !== null) clearTimeout(this._preparationTimer);
    this._preparationTimer = null;
    this._limitReportedBeforeLoad = false;
    this._preparedDocumentUnwritten = false;
  }

  private _reportLimitBeforeLoad(): void {
    this._preparationTimer = null;
    if (!this._navigationPending || this._callbacks.hostOwnsDeadline?.()) return;
    this._limitReportedBeforeLoad = true;
    this._callbacks.onError(
      timelineNotFound(this._limitMs, this._callbacks.unreadSealedLoad?.() === true),
    );
  }

  get limitMs(): number {
    return this._limitMs;
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
    if (this._preparedDocumentUnwritten) return;
    if (!this._navigationPending) {
      this._startedAt = performance.now();
      this._limitMs = loadLimitMs();
      this._timedFromNavigation = false;
    }
    this._navigationPending = false;
    let attempts = 0;
    let limitReached = this._limitReportedBeforeLoad;
    this._endPreparation();

    const tick = () => {
      attempts++;
      const outcome = this._readOutcomeAcrossOrigins(attempts);
      if (outcome) return this._settle(outcome);
      if (limitReached || performance.now() - this._startedAt < this._limitMs) return;
      limitReached = true;
      if (!this._callbacks.hostOwnsDeadline?.()) this._failAtLimit(tick);
    };
    this._interval = setInterval(tick, POLL_MS);
  }

  private _readOutcomeAcrossOrigins(attempts: number): ProbeOutcome {
    if (this._frameError !== null) return { kind: "error", message: this._frameError };
    try {
      return this._poll(attempts);
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") return null;
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private _settle(outcome: NonNullable<ProbeOutcome>): void {
    this.stop();
    this._frameError = null;
    if (outcome.kind === "ready") {
      this._callbacks.onReady(outcome.result);
      return;
    }
    this._failure = { document: this._iframe.contentDocument, deadline: false };
    this._callbacks.onError(outcome.message);
  }

  private _failAtLimit(tick: () => void): void {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(tick, LATE_POLL_MS);
    this._failure = { document: this._iframe.contentDocument, deadline: true };
    this._callbacks.onError(
      timelineNotFound(this._limitMs, this._callbacks.unreadSealedLoad?.() === true),
    );
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

  latchUntilNextLoad(): void {
    if (this._failure) this._failure.deadline = false;
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
        this._failure = { document: doc, deadline: false };
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
