import type { ProducerLogger } from "../../logger.js";
import type { ProgressCallback } from "../renderOrchestrator.js";
import { OrderedRenderEventPublisher } from "./renderEventPublisher.js";

export interface RenderExecutionRequestIdentity {
  renderJobId: string;
  projectDir: string;
  outputPath: string;
}

export type RenderDisposer = () => Promise<void> | void;

interface RegisteredDisposer {
  active: boolean;
  label: string;
  dispose: RenderDisposer;
}

export interface RenderExecutionContextOptions {
  request: RenderExecutionRequestIdentity;
  logger: ProducerLogger;
  progressSink?: ProgressCallback;
  signal?: AbortSignal;
  deadlineAtMs?: number;
}

function scopedLogger(
  logger: ProducerLogger,
  fields: Readonly<Record<string, unknown>>,
): ProducerLogger {
  const merge = (meta?: Record<string, unknown>) => ({ ...fields, ...meta });
  return {
    error: (message, meta) => logger.error(message, merge(meta)),
    warn: (message, meta) => logger.warn(message, merge(meta)),
    info: (message, meta) => logger.info(message, merge(meta)),
    debug: (message, meta) => logger.debug(message, merge(meta)),
    isLevelEnabled: logger.isLevelEnabled?.bind(logger),
  };
}

function composeSignal(signal?: AbortSignal, deadlineAtMs?: number): AbortSignal | undefined {
  if (deadlineAtMs === undefined) return signal;
  const remainingMs = Math.max(0, deadlineAtMs - Date.now());
  const deadlineSignal =
    remainingMs === 0
      ? AbortSignal.abort(new Error("render_deadline_exceeded"))
      : AbortSignal.timeout(Math.min(remainingMs, 2_147_483_647));
  return signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
}

/** Owns one render execution's control-plane resources and terminal cleanup. */
export class RenderExecutionContext {
  readonly request: Readonly<RenderExecutionRequestIdentity>;
  readonly signal: AbortSignal | undefined;
  readonly logger: ProducerLogger;
  readonly events: OrderedRenderEventPublisher;
  readonly onProgress: ProgressCallback | undefined;

  private readonly disposers: RegisteredDisposer[] = [];
  private disposePromise: Promise<void> | null = null;

  constructor(options: RenderExecutionContextOptions) {
    this.request = Object.freeze({ ...options.request });
    this.signal = composeSignal(options.signal, options.deadlineAtMs);
    this.logger = scopedLogger(options.logger, { renderJobId: options.request.renderJobId });
    this.events = new OrderedRenderEventPublisher(options.progressSink, this.logger);
    this.onProgress = options.progressSink
      ? (job, message) => this.events.publish(job, message)
      : undefined;
  }

  /** Register cleanup in acquisition order; execution is LIFO and exactly once. */
  defer(label: string, dispose: RenderDisposer): () => void {
    if (this.disposePromise) throw new Error("Cannot register a disposer after context disposal");
    const entry: RegisteredDisposer = { active: true, label, dispose };
    this.disposers.push(entry);
    return () => {
      entry.active = false;
    };
  }

  assertActive(createError: () => Error = () => new Error("render_cancelled")): void {
    if (this.signal?.aborted) throw createError();
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOnce();
    return this.disposePromise;
  }

  private async disposeOnce(): Promise<void> {
    await this.events.flush();
    for (const entry of this.disposers.reverse()) {
      if (!entry.active) continue;
      entry.active = false;
      try {
        await entry.dispose();
      } catch (error) {
        try {
          this.logger.debug(`Cleanup failed (${entry.label})`, {
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Cleanup and its diagnostics are both best-effort: neither may mask
          // the render outcome that caused disposal.
        }
      }
    }
  }
}
