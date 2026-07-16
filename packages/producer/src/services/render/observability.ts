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
  /** DE parallel-router outcome: "routed" (fired, held) | "reverted" (fired, self-verify retry rolled back). */
  deParallelRouter?: "routed" | "reverted";
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

function summarizeInitObservability(lines: string[]): RenderInitObservability | undefined {
  let initDurationMs: number | undefined;
  let tweenCount: number | undefined;
  for (const line of lines) {
    if (!line.includes("[FrameCapture:INIT]")) continue;
    const duration = readUnsignedIntAfter(line, "initDurationMs=");
    const tweens = readUnsignedIntAfter(line, "tweenCount=");
    // Multiple worker/session INIT records can appear; keep the worst observed startup cost.
    if (duration !== undefined) {
      initDurationMs = initDurationMs === undefined ? duration : Math.max(initDurationMs, duration);
    }
    if (tweens !== undefined) {
      tweenCount = tweenCount === undefined ? tweens : Math.max(tweenCount, tweens);
    }
  }
  if (initDurationMs === undefined && tweenCount === undefined) return undefined;
  return { initDurationMs, tweenCount };
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
      init: summarizeInitObservability(input.lastBrowserConsole),
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
