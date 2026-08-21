import { createHash } from "node:crypto";
import { redactTelemetryString } from "@hyperframes/core";
import type { ProducerLogger } from "../../logger.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";

export type RenderObservationStatus = "start" | "end" | "error" | "checkpoint";
export type RenderObservationValue = string | number | boolean | null;
export type RenderObservationData = Record<string, RenderObservationValue>;

export interface RenderObservationEvent {
  renderJobId?: string;
  phase: string;
  status: RenderObservationStatus;
  elapsedMs: number;
  durationMs?: number;
  message?: string;
  data?: RenderObservationData;
}

export interface BrowserDiagnosticSummary {
  total: number;
  /** Generic browser error lines after page/request/navigation/console-specific diagnostics are classified. */
  errors: number;
  pageErrors: number;
  requestFailed: number;
  httpErrors: number;
  navigationStarts: number;
  navigationFailures: number;
  consoleErrors: number;
  consoleWarnings: number;
}

export interface RenderCaptureObservability {
  forceScreenshot: boolean;
  captureMode: "screenshot" | "beginframe";
  captureBeyondViewport?: boolean;
  workerCount?: number;
  useStreamingEncode?: boolean;
  useLayeredComposite?: boolean;
  usePageSideCompositing?: boolean;
  hasHdrContent?: boolean;
  browserGpuMode?: string;
  /**
   * drawElement per-render SELF-VERIFICATION tripped (blank/PSNR) → whole
   * render re-ran via screenshot. NARROWED semantics since the pinned-fallback
   * retry was widened (review): OOM- and generic-capture-error-triggered
   * fallbacks report FALSE here, with `deFallbackReason` ∈ {oom,
   * capture_error}. The "any fallback fired" signal is `deFallbackReason`
   * being set, NOT this flag — dashboards keyed on `de_self_verify_fallback =
   * true` as any-fallback must migrate to `de_fallback_reason IS NOT NULL`.
   */
  deSelfVerifyFallback?: boolean;
  /**
   * Why the capture-stage retry (self-verify OR the pinned-worker-count
   * fallback) fired: "blank"/"psnr" for a real self-verify trip,
   * "oom"/"capture_error" for the widened generic-failure retry. Set
   * whenever a fallback is attempted, independent of whether that retry
   * itself later succeeds — so a render that fails AFTER a fallback attempt
   * (perfSummary never built) is still distinguishable in failure-path
   * telemetry from one that never attempted any fallback.
   */
  deFallbackReason?: string;
  /** The failing PSNR (dB) when `deFallbackReason === "psnr"`; undefined for blank/oom/capture_error (no score exists). */
  deFallbackFailedDb?: number;
  /** Frame index the verification failure was detected at; set for both "psnr" and "blank" fallback reasons. */
  deFallbackFrameIndex?: number;
  /** The HF_DE_VERIFY_MIN_DB threshold the failing dB breached; only set alongside deFallbackFailedDb (psnr reason). */
  deFallbackThresholdDb?: number;
  /** Auto-parallel inversion outcome: "inverted" (fired, held) | "reverted" (fired, self-verify retry rolled back). */
  deWorkerInversion?: "inverted" | "reverted";
  /** Worker count the resolver would have used absent the inversion; undefined if it never fired. */
  dePreInversionWorkers?: number;
  /**
   * Element count for the short-comp band gate (`resolveCompositionElementCount`):
   * the LIVE DOM size from the already-running probe session when one is
   * initialized, falling back to a static scan of the compiled HTML
   * (`countElementTags`) otherwise. Live is authoritative — a static scan
   * cannot see elements a composition's own script creates at runtime.
   *
   * Emitted on every render, not just inverted ones — this is the variable the
   * short-comp inversion band is gated on, and the fleet distribution of it is
   * unknown. Without it there is no way to tell whether the 2500 ceiling opens
   * the band for most short comps or almost none, and no way to re-derive the
   * threshold from real content instead of synthetic sweeps.
   */
  compositionElementCount?: number;
  /**
   * Provenance of `compositionElementCount`: "live" (measured from the probe
   * session's real DOM — sees runtime-generated elements) or "static" (source
   * markup scan, which does not). The probe is CONDITIONAL, so this is not a
   * detail: only a `live` count may open the short band, and the fleet rate of
   * "static" sizes the population a future conditional-probe-launch would
   * unlock for the band.
   */
  compositionElementCountSource?: "live" | "static";
  /**
   * Short-comp band decision, emitted only when the band is DECISIVE — every
   * other inversion-eligibility condition passed and only the floor (250 vs
   * 900) differed. "applied": the element count cleared the ceiling too, so
   * with routing enabled (HF_DE_SHORT_BAND_ROUTE) this render inverts; in the
   * baseline release the same value is the COUNTERFACTUAL "would have
   * inverted". "skipped_elements": the element ceiling was the only blocker.
   * Unset: the band could not have affected this render (ineligible for some
   * other reason, or already inverting at 900+). The selector is computed
   * identically before and after the routing flip, and the skipped/oversize
   * renders form the concurrent control for the difference-in-differences
   * read — that is the entire point of the field.
   */
  deShortBand?: "applied" | "skipped_elements" | "unmeasured";
  /** DE parallel-router outcome: "routed" (fired, held) | "reverted" (fired, self-verify retry rolled back). */
  deParallelRouter?: "routed" | "reverted";
  /**
   * Low-cardinality GPU bucket (`<backend>/<vendor>`) from the DE probe
   * session. Lives on capture observability (not just perfSummary) so a hard
   * failure — crash / OOM / timeout — still reports which GPU backend it hit:
   * that is precisely the cohort the win32 D3D11 rollout must attribute.
   */
  deGpuRenderer?: string;
  /** Worker count the resolver would have used absent the router; undefined if it never fired. */
  dePreRouterWorkers?: number;
  /**
   * Non-DE parallel-streaming router outcome (HF_CAPTURE_PARALLEL_STREAM):
   * "screenshot" | "beginframe" — the render passed every gate AND the kill
   * switch was on, so it was routed through the interleaved streaming encoder
   * (the value is the capture mode that streamed); "eligible_off" — the render
   * passed every gate EXCEPT the kill switch (passive cohort-sizing signal for
   * the default-off soak: how many renders WOULD route if enabled). Absent =
   * ineligible regardless of the switch.
   */
  captureParallelStream?: "screenshot" | "beginframe" | "eligible_off";
  protocolTimeoutMs?: number;
  pageNavigationTimeoutMs?: number;
  playerReadyTimeoutMs?: number;
  /**
   * Render-reliability counters (see PostHog dashboard 1783183). Emitted so the
   * capture-hardening in #1842 is measurable from a metric, not just logs:
   * how often the bounded transient-tab-death retry fired on a render that
   * ultimately succeeded, and whether the failure was classified as an
   * out-of-memory exhaustion (`Set maximum size exceeded` and friends).
   */
  transientRetries?: number;
  memoryExhaustionDetected?: boolean;
}

export interface RenderExtractionObservability {
  videoCount: number;
  extractedVideoCount: number;
  totalFramesExtracted: number;
  maxFramesPerVideo: number;
  avgFramesPerExtractedVideo?: number;
  vfrProbeMs?: number;
  vfrPreflightMs?: number;
  vfrPreflightCount?: number;
  cacheHits?: number;
  cacheMisses?: number;
  /** Per-source transient download/metadata/FFmpeg retries performed during extraction. */
  transientRetries?: number;
  /**
   * Per-clip captured-vs-expected-frame gauges. Emitted by the parity gate
   * at extract finalization (see `videoFrameCoverage.ts`). Undefined when
   * the render has no source videos to cover.
   *
   * • `minVideoFrameCoverageRatio` — worst clip's `captured / expected`
   *   ratio (0 when a clip was never extracted; a strong "later-injected
   *   clip silently dropped" signal per field ts=1784139267).
   * • `coverageShortfallClipCount` — clips whose ratio fell below the
   *   configured threshold (`HF_VIDEO_COVERAGE_THRESHOLD`, default 0.95).
   *   Non-zero only ever accompanies a `VideoFrameCoverageError` throw.
   */
  minVideoFrameCoverageRatio?: number;
  coverageShortfallClipCount?: number;
  /**
   * Count of authored `[data-start]` clip windows in the compiled HTML —
   * a coarse proxy for the ts=1784144554 field signal shape (147-clip
   * composition, 130 word-level caption divs authored-clip-count-scaled
   * failure). Static scan; dynamic script-inserted timed clips land in
   * the probe-stage's `hasRuntimeInsertedMedia` path (PR #2474).
   */
  authoredTimedClipCount?: number;
}

export interface RenderInitObservability {
  initDurationMs?: number;
  tweenCount?: number;
  /**
   * Live DOM element count at end of capture-session init; undefined when
   * the measurement failed (never 0). Observational: measured after routing
   * has already been decided, so it cannot gate — it exists because the
   * routing gate's own count is only available on the ~17% of renders that
   * get a probe session, leaving the fleet element-count distribution (and
   * any large-runtime-DOM tail) unreadable for the rest.
   *
   * Not interchangeable with `RenderCaptureObservability.compositionElementCount`:
   * that one is measured pre-routing from the probe session (or a static
   * scan) and is what the band gates on. This one is measured post-routing
   * from the capture session and covers renders the gate cannot see. Query
   * the former for router behaviour, this for distribution/tail analysis.
   */
  elementCount?: number;
}

export interface RenderObservabilitySummary {
  renderJobId?: string;
  compositionHash?: string;
  events: RenderObservationEvent[];
  eventCount: number;
  lastEvent?: RenderObservationEvent;
  failedPhase?: string;
  browserDiagnostics: BrowserDiagnosticSummary;
  capture: RenderCaptureObservability;
  extraction?: RenderExtractionObservability;
  init?: RenderInitObservability;
}

const MAX_EVENTS = 160;
/** Allow-list of non-sensitive string fields accepted into structured render trace data. */
const ALLOWED_STRING_DATA_KEYS = new Set([
  "browserGpuMode",
  "captureMode",
  "captureOperation",
  "compositionHash",
  "effectiveHdr",
  "format",
  "quality",
  "renderJobId",
  "requestedHdrMode",
  "requestedWorkers",
  // "calibrating" during pre-capture browser warm-up / calibration stages;
  // "capturing" during capture_disk / capture_streaming / capture_hdr_*
  // stages. Distinguishes healthy 0-frame heartbeats (browser starting up)
  // from actual zero-frame stalls once capture is meant to be underway.
  // Field signal ts=1784019503.
  "stagePhase",
  // Full-fidelity fast-capture fallback trigger — the specific reason
  // drawElement gated off ("filter:blur", "filter:drop-shadow",
  // "backdrop-filter", "clip-path", "at_risk_timeline", "swiftshader", …).
  // Populated on the `capture_fallback_profile` checkpoint emitted by
  // `fallbackCaptureProfile.ts` when the operator opts into
  // `HF_PROFILE_FALLBACK_CAPTURE=true` so downstream metric consumers can
  // characterize per-frame perf by the exact trigger. Complementary to
  // `deGateReason`, which is the low-cardinality bucket for aggregation —
  // this string preserves the fine-grained "which CSS property" for
  // diagnostic reads. Sanitized like any observation message; low-cardinality
  // by construction (bounded by the fallback-trigger enumeration).
  "triggerReason",
]);
const RESERVED_LOG_KEYS = new Set([
  "data",
  "durationMs",
  "elapsedMs",
  "message",
  "phase",
  "renderJobId",
  "status",
]);

export function sanitizeObservationMessage(value: string): string {
  return redactTelemetryString(value);
}

export function computeCompositionObservabilityHash(compiledHtml: string): string {
  return createHash("sha256").update(compiledHtml, "utf8").digest("hex").slice(0, 16);
}

function sanitizeObservationData(
  data: RenderObservationData | undefined,
): RenderObservationData | undefined {
  if (!data) return undefined;
  const sanitized: RenderObservationData = {};
  for (const [key, value] of Object.entries(data)) {
    if (RESERVED_LOG_KEYS.has(key)) continue;
    if (typeof value === "string") {
      if (!ALLOWED_STRING_DATA_KEYS.has(key)) continue;
      sanitized[key] = sanitizeObservationMessage(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isHttpErrorDiagnostic(line: string): boolean {
  return /\[Browser:HTTP\d{3}\]/.test(line);
}

function readUnsignedIntAfter(line: string, prefix: string): number | undefined {
  const start = line.indexOf(prefix);
  if (start < 0) return undefined;
  let value = 0;
  let digits = 0;
  for (let i = start + prefix.length; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 48 || code > 57) break;
    value = value * 10 + code - 48;
    digits += 1;
    if (value > Number.MAX_SAFE_INTEGER) return undefined;
  }
  return digits > 0 ? value : undefined;
}

/** Max of two optional readings — multiple worker/session INIT records can appear; keep the worst. */
function maxReading(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return current === undefined ? next : Math.max(current, next);
}

function summarizeInitObservability(
  lines: string[],
  fallback?: RenderInitObservability,
): RenderInitObservability | undefined {
  // Console parsing only sees THIS process's session buffer, so parallel
  // workers' INIT lines never reach it — their init telemetry arrives
  // structured via the per-worker perf summaries instead. Seed with that and
  // let the console parse (same max semantics) refine it.
  let initDurationMs: number | undefined = fallback?.initDurationMs;
  let tweenCount: number | undefined = fallback?.tweenCount;
  let elementCount: number | undefined = fallback?.elementCount;
  for (const line of lines) {
    if (!line.includes("[FrameCapture:INIT]")) continue;
    initDurationMs = maxReading(initDurationMs, readUnsignedIntAfter(line, "initDurationMs="));
    tweenCount = maxReading(tweenCount, readUnsignedIntAfter(line, "tweenCount="));
    elementCount = maxReading(elementCount, readUnsignedIntAfter(line, "elementCount="));
  }
  if (initDurationMs === undefined && tweenCount === undefined && elementCount === undefined) {
    return undefined;
  }
  return { initDurationMs, tweenCount, elementCount };
}

// fallow-ignore-next-line complexity
export function summarizeBrowserDiagnostics(lines: string[]): BrowserDiagnosticSummary {
  let errors = 0;
  let pageErrors = 0;
  let requestFailed = 0;
  let httpErrors = 0;
  let navigationStarts = 0;
  let navigationFailures = 0;
  let consoleErrors = 0;
  let consoleWarnings = 0;

  for (const line of lines) {
    const isPageError = line.includes("PAGEERROR");
    const isRequestFailed = line.includes("REQUESTFAILED");
    const isHttpError = isHttpErrorDiagnostic(line);
    const isNavigationFailure = line.includes("[FrameCapture:ERROR] page.goto failed");
    const isConsoleError = line.includes("[error]");

    if (isPageError) pageErrors++;
    if (isRequestFailed) requestFailed++;
    if (isHttpError) httpErrors++;
    if (line.includes("[FrameCapture:NAV] page.goto start")) navigationStarts++;
    if (isNavigationFailure) navigationFailures++;
    if (isConsoleError) consoleErrors++;
    if (line.includes("[warn]")) consoleWarnings++;
    if (
      line.includes("ERROR") &&
      !isPageError &&
      !isRequestFailed &&
      !isHttpError &&
      !isNavigationFailure &&
      !isConsoleError
    ) {
      errors++;
    }
  }

  return {
    total: lines.length,
    errors,
    pageErrors,
    requestFailed,
    httpErrors,
    navigationStarts,
    navigationFailures,
    consoleErrors,
    consoleWarnings,
  };
}

export class RenderObservabilityRecorder {
  private readonly events: RenderObservationEvent[] = [];
  private eventCount = 0;
  private failedPhase: string | undefined;

  constructor(
    private readonly input: {
      pipelineStartMs: number;
      log: ProducerLogger;
      renderJobId?: string;
    },
  ) {}

  checkpoint(phase: string, message: string, data?: RenderObservationData): RenderObservationEvent {
    return this.record({
      phase,
      status: "checkpoint",
      elapsedMs: Date.now() - this.input.pipelineStartMs,
      message: sanitizeObservationMessage(message),
      data: sanitizeObservationData(data),
    });
  }

  stageStart(phase: string, data?: RenderObservationData): number {
    this.record({
      phase,
      status: "start",
      elapsedMs: Date.now() - this.input.pipelineStartMs,
      data: sanitizeObservationData(data),
    });
    return Date.now();
  }

  stageEnd(phase: string, startedAtMs: number, data?: RenderObservationData): void {
    this.record({
      phase,
      status: "end",
      elapsedMs: Date.now() - this.input.pipelineStartMs,
      durationMs: Date.now() - startedAtMs,
      data: sanitizeObservationData(data),
    });
  }

  stageError(
    phase: string,
    startedAtMs: number,
    error: unknown,
    data?: RenderObservationData,
  ): void {
    this.failedPhase = phase;
    this.record({
      phase,
      status: "error",
      elapsedMs: Date.now() - this.input.pipelineStartMs,
      durationMs: Date.now() - startedAtMs,
      message: sanitizeObservationMessage(normalizeErrorMessage(error)),
      data: sanitizeObservationData(data),
    });
  }

  summary(input: {
    lastBrowserConsole: string[];
    capture: RenderCaptureObservability;
    /** Structured init telemetry from per-worker perf summaries — the only success-path channel parallel workers have (their console buffers propagate on failure only). */
    initFallback?: RenderInitObservability;
    extraction?: RenderExtractionObservability;
    compositionHash?: string;
  }): RenderObservabilitySummary {
    const lastEvent = this.events[this.events.length - 1];
    return {
      renderJobId: this.input.renderJobId,
      compositionHash: input.compositionHash,
      events: this.events.slice(),
      eventCount: this.eventCount,
      lastEvent,
      failedPhase: this.failedPhase,
      browserDiagnostics: summarizeBrowserDiagnostics(input.lastBrowserConsole),
      capture: { ...input.capture },
      extraction: input.extraction ? { ...input.extraction } : undefined,
      init: summarizeInitObservability(input.lastBrowserConsole, input.initFallback),
    };
  }

  hasFailure(): boolean {
    return this.failedPhase !== undefined;
  }

  /** A phase failure that was subsequently recovered (e.g. the drawElement
   * self-verify fallback re-rendering via screenshot) should not brand the
   * whole render as failed in the summary. */
  clearFailure(phase: string): void {
    if (this.failedPhase === phase) this.failedPhase = undefined;
  }

  private record(event: RenderObservationEvent): RenderObservationEvent {
    this.eventCount++;
    const eventWithJob = { ...event, renderJobId: this.input.renderJobId };
    this.events.push(eventWithJob);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }

    this.input.log.info("[Render:trace]", {
      renderJobId: eventWithJob.renderJobId,
      phase: eventWithJob.phase,
      status: eventWithJob.status,
      elapsedMs: eventWithJob.elapsedMs,
      durationMs: eventWithJob.durationMs,
      message: eventWithJob.message,
      ...eventWithJob.data,
    });

    return eventWithJob;
  }
}

/** Heartbeat ramp before falling back to a steady repeat cadence. */
const HEARTBEAT_RAMP_MS = [30_000, 60_000, 120_000];
const HEARTBEAT_REPEAT_MS = 120_000;
const HEARTBEAT_RAMP_END_MS =
  HEARTBEAT_RAMP_MS[HEARTBEAT_RAMP_MS.length - 1] ?? HEARTBEAT_REPEAT_MS;

/** Target elapsed-ms for the Nth heartbeat (0-indexed): ramp, then steady repeat so long stalls keep emitting breadcrumbs instead of going dark after the ramp. */
function heartbeatTargetMs(index: number): number {
  const rampTarget = HEARTBEAT_RAMP_MS[index];
  if (rampTarget !== undefined) return rampTarget;
  const overflow = index - HEARTBEAT_RAMP_MS.length + 1;
  return HEARTBEAT_RAMP_END_MS + overflow * HEARTBEAT_REPEAT_MS;
}

/**
 * Options for `observeRenderStage` heartbeat behavior.
 *
 * The default heartbeat message is "stage still running", chosen for the
 * capture stages where a live frame count in the observation data already
 * communicates progress. Stages that run BEFORE any frame count is
 * meaningful — the ~64s browser calibration path in particular — inherit
 * that default and confusingly report "stage still running / framesCompleted:
 * 0" to downstream consumers. Field signal ts=1784019503 captured exactly
 * that read-as-broken shape on a healthy 64s calibration.
 *
 * `heartbeatMessage` lets the calibration call sites override the message
 * to "browser calibrating" so operator-facing logs and downstream metrics
 * can distinguish healthy pre-capture waits from actual zero-frame stalls
 * mid-capture. The `data` payload also flows through (callers pass a
 * `stagePhase: "calibrating" | "capturing"` field) so structured consumers
 * don't have to string-match on the message.
 */
export interface ObserveRenderStageOptions {
  /**
   * Message to attach to each heartbeat checkpoint for this stage.
   * Defaults to "stage still running".
   */
  heartbeatMessage?: string;
}

export async function observeRenderStage<T>(
  recorder: RenderObservabilityRecorder,
  phase: string,
  data: RenderObservationData | undefined,
  fn: () => Promise<T>,
  options: ObserveRenderStageOptions = {},
): Promise<T> {
  const heartbeatMessage = options.heartbeatMessage ?? "stage still running";
  const startedAt = recorder.stageStart(phase, data);
  let heartbeatCount = 0;
  let lastFiredAtMs = 0;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleNextHeartbeat = () => {
    const targetMs = heartbeatTargetMs(heartbeatCount);
    heartbeatTimer = setTimeout(() => {
      lastFiredAtMs = targetMs;
      heartbeatCount += 1;
      recorder.checkpoint(phase, heartbeatMessage, {
        ...data,
        heartbeatIndex: heartbeatCount,
        stageElapsedMs: Date.now() - startedAt,
      });
      scheduleNextHeartbeat();
    }, targetMs - lastFiredAtMs);
    heartbeatTimer.unref?.();
  };
  scheduleNextHeartbeat();
  const clearHeartbeats = () => {
    clearTimeout(heartbeatTimer);
  };
  try {
    const result = await fn();
    clearHeartbeats();
    recorder.stageEnd(phase, startedAt, data);
    return result;
  } catch (error) {
    clearHeartbeats();
    recorder.stageError(phase, startedAt, error, data);
    throw error;
  }
}
