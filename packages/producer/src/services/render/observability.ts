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
  /** drawElement per-render self-verification tripped → whole render re-ran via screenshot. */
  deSelfVerifyFallback?: boolean;
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
  "compositionHash",
  "effectiveHdr",
  "format",
  "quality",
  "renderJobId",
  "requestedHdrMode",
  "requestedWorkers",
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

export async function observeRenderStage<T>(
  recorder: RenderObservabilityRecorder,
  phase: string,
  data: RenderObservationData | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = recorder.stageStart(phase, data);
  try {
    const result = await fn();
    recorder.stageEnd(phase, startedAt);
    return result;
  } catch (error) {
    recorder.stageError(phase, startedAt, error);
    throw error;
  }
}
