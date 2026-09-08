import { writeSync } from "node:fs";

export const PROGRESS_FORMATS = ["tty", "ndjson", "none"] as const;
export type ProgressFormat = (typeof PROGRESS_FORMATS)[number];
export const PROGRESS_FORMAT_LABEL = "tty, ndjson, or none";

export function parseProgressFormat(input: string): ProgressFormat | undefined {
  return PROGRESS_FORMATS.find((format) => format === input);
}

/**
 * Structural view of the producer's `RenderJob` limited to the fields the
 * NDJSON stream serializes. Kept structural (rather than importing the
 * producer type) so the writer stays unit-testable with plain objects and
 * `@hyperframes/producer` stays out of this module's import graph.
 */
export interface NdjsonRenderJobView {
  status: string;
  /** Pipeline progress in percent (0–100), as maintained by the producer. */
  progress: number;
  currentStage: string;
  framesRendered?: number;
  totalFrames?: number;
  failedStage?: string;
  error?: string;
  errorDetails?: unknown;
}

/** One line-oriented output the writer appends `\n`-terminated JSON to. */
export type NdjsonSink = (line: string) => void;

/**
 * Sink for `--progress-format ndjson`: stdout by default, or an inherited
 * file descriptor via `--progress-fd N` (so human stdout stays usable).
 * A sink failure (e.g. EPIPE when the consumer exits early) disables the
 * stream instead of crashing the render — mirroring the producer's
 * OrderedRenderEventPublisher, which contains sink failures at the boundary.
 */
export function createNdjsonSink(fd?: number): NdjsonSink {
  if (fd === undefined) {
    return (line: string) => {
      process.stdout.write(line);
    };
  }
  return (line: string) => {
    writeSync(fd, line);
  };
}

/**
 * When the NDJSON stream owns stdout, every other stdout writer in the
 * process has to move to stderr or the pipe stops being parseable. The CLI's
 * own prints are already quiet-suppressed, but library diagnostics (e.g. the
 * engine's `[BrowserManager] Browser launched` line) write via `console.log`
 * directly — reroute the stdout-bound console channels to stderr for the
 * remainder of the process. The stream itself is unaffected: it writes
 * through `process.stdout.write`, not the console.
 */
interface StdoutBoundConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function redirectConsoleStdoutToStderr(target: StdoutBoundConsole = console): void {
  // console.error targets stderr regardless of the original channel.
  const toStderr = (...args: unknown[]): void => {
    target.error(...args);
  };
  target.log = toStderr;
  target.info = toStderr;
  target.debug = toStderr;
}

export interface ProgressNdjsonWriterOptions {
  sink: NdjsonSink;
  /** Batch row index stamped onto every event of this render. */
  row?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Convert the producer's 0–100 percentage into a 0–1 fraction. */
function progressFraction(progressPercent: number): number {
  const bounded = Math.max(0, Math.min(100, progressPercent));
  return Math.round(bounded * 100) / 10000;
}

function frameCount(value: number | undefined): number {
  return value ?? 0;
}

/**
 * Streams machine-readable render progress as NDJSON: one JSON object per
 * line, one line per progress tick. Three event types:
 *
 * - `render.progress` — a progress tick while the pipeline runs.
 * - `render.completed` — terminal success.
 * - `render.failed` — terminal failure, carrying `failedStage` and the
 *   producer's structured `errorDetails`.
 *
 * Exactly one terminal event is emitted per writer (= per render / batch
 * row); anything published after it is dropped, so the double-report paths —
 * the producer's own terminal status tick plus the CLI's failure handler —
 * cannot duplicate the terminal line.
 */
export class ProgressNdjsonWriter {
  private readonly sink: NdjsonSink;
  private readonly row: number | undefined;
  private readonly now: () => Date;
  private terminal = false;
  private sinkBroken = false;

  constructor(options: ProgressNdjsonWriterOptions) {
    this.sink = options.sink;
    this.row = options.row;
    this.now = options.now ?? (() => new Date());
  }

  /** ProgressCallback-compatible entry: routes ticks to the right event type. */
  publish(job: NdjsonRenderJobView, message: string): void {
    if (job.status === "failed") {
      this.failed(job.error ?? message, job);
      return;
    }
    if (job.status === "complete") {
      this.completed(job, message);
      return;
    }
    if (this.terminal) return;
    this.write({
      type: "render.progress",
      ts: this.now().toISOString(),
      progress: progressFraction(job.progress),
      status: job.status,
      stage: job.currentStage,
      message,
      framesRendered: frameCount(job.framesRendered),
      totalFrames: frameCount(job.totalFrames),
      failedStage: null,
      ...(this.row !== undefined ? { row: this.row } : {}),
    });
    // A cancelled render never reaches a completed/failed terminal event;
    // latch after reporting the cancellation tick so teardown noise can't
    // trail it on the stream.
    if (job.status === "cancelled") this.terminal = true;
  }

  /** Terminal success event. Safe to call after the producer's own tick. */
  completed(job: NdjsonRenderJobView, message = "Render complete"): void {
    if (this.terminal) return;
    this.terminal = true;
    this.write({
      type: "render.completed",
      ts: this.now().toISOString(),
      progress: 1,
      status: "complete",
      stage: job.currentStage,
      message,
      framesRendered: frameCount(job.framesRendered),
      totalFrames: frameCount(job.totalFrames),
      failedStage: null,
      ...(this.row !== undefined ? { row: this.row } : {}),
    });
  }

  /**
   * Terminal failure event including the producer's failure contract
   * (`failedStage` + `errorDetails`). `job` is optional so failures that
   * never produced a job (preflight, environment) still emit a terminal line.
   */
  failed(error: string, job?: NdjsonRenderJobView): void {
    if (this.terminal) return;
    this.terminal = true;
    this.write({
      type: "render.failed",
      ts: this.now().toISOString(),
      progress: progressFraction(job?.progress ?? 0),
      status: "failed",
      stage: job?.currentStage ?? "pipeline",
      message: error,
      error,
      framesRendered: frameCount(job?.framesRendered),
      totalFrames: frameCount(job?.totalFrames),
      failedStage: job?.failedStage ?? job?.currentStage ?? null,
      errorDetails: job?.errorDetails ?? null,
      ...(this.row !== undefined ? { row: this.row } : {}),
    });
  }

  private write(event: Record<string, unknown>): void {
    if (this.sinkBroken) return;
    try {
      this.sink(JSON.stringify(event) + "\n");
    } catch {
      // The consumer went away (EPIPE) or the fd is invalid. The render
      // itself must keep going; stop emitting rather than crash.
      this.sinkBroken = true;
    }
  }
}
