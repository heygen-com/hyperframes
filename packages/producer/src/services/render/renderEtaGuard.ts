const RENDER_TOO_SLOW = "RENDER_TOO_SLOW" as const;

/** Fail only when the ETA clears the budget by this factor, so borderline renders survive. */
const ETA_MARGIN = 1.2;
/** The measured rate needs this much capture time and frames; the first frame's warm-up is excluded. */
const MIN_SAMPLE_MS = 60_000;
const MIN_SAMPLE_FRAMES = 3;
const POLL_MS = 5_000;

interface RenderEtaInput {
  /** Absent or 0 means no guard. */
  maxRenderMs?: number;
  /** Wall time since the render started, so time already spent counts. */
  elapsedMs: number;
  framesCompleted: number;
  totalFrames: number;
  /** Wall ms per frame across all workers. */
  msPerFrame: number;
}

export class RenderTooSlowError extends Error {
  readonly code = RENDER_TOO_SLOW;
  // The producer server reads these off the error for the wire envelope.
  // fallow-ignore-next-line unused-class-member
  readonly owner = "user" as const;
  // fallow-ignore-next-line unused-class-member
  readonly retryable = false as const;
  readonly publicMetadata: Readonly<Record<string, unknown>>;

  constructor(stage: string, input: Required<RenderEtaInput> & { etaMs: number }) {
    const { framesCompleted, totalFrames, msPerFrame, etaMs, maxRenderMs } = input;
    super(
      `render too slow: stage ${stage}, ${framesCompleted}/${totalFrames} frames, ` +
        `${Math.round(msPerFrame)} ms/frame, ETA ${etaMs} ms exceeds maxRenderMs ${maxRenderMs}`,
    );
    this.name = "RenderTooSlowError";
    this.publicMetadata = { stage, framesCompleted, totalFrames, msPerFrame, etaMs, maxRenderMs };
  }
}

/** The one ETA decision, shared by the post-calibration and the measured-rate checks. */
export function checkRenderEta(
  stage: string,
  input: RenderEtaInput,
): RenderTooSlowError | undefined {
  const { maxRenderMs, elapsedMs, framesCompleted, totalFrames, msPerFrame } = input;
  if (!maxRenderMs || maxRenderMs <= 0 || !(msPerFrame > 0)) return undefined;
  const etaMs = Math.round(elapsedMs + (totalFrames - framesCompleted) * msPerFrame);
  if (etaMs <= maxRenderMs * ETA_MARGIN) return undefined;
  return new RenderTooSlowError(stage, { ...input, maxRenderMs, etaMs });
}

interface RenderEtaGuardOptions {
  maxRenderMs?: number;
  job: { framesRendered?: number };
  totalFrames: number;
  pipelineStartMs: number;
  onTooSlow: (error: RenderTooSlowError) => void;
  now?: () => number;
  pollMs?: number;
}

/** Measured wall ms per frame once enough capture time and frames are in; a counter reset restarts the sample. */
function createRateSampler() {
  let base: { at: number; frames: number } | undefined;
  let lastFrames = 0;
  return {
    observe(done: number, at: number): number | undefined {
      if (done === 0 || done < lastFrames) base = undefined;
      lastFrames = done;
      if (done === 0) return undefined;
      base ??= { at, frames: done };
      const sampleMs = at - base.at;
      const sampleFrames = done - base.frames;
      if (sampleMs < MIN_SAMPLE_MS || sampleFrames < MIN_SAMPLE_FRAMES) return undefined;
      return sampleMs / sampleFrames;
    },
  };
}

/** Polls `job.framesRendered`, which every capture path updates, and trips once. Returns stop(). */
export function startRenderEtaGuard(options: RenderEtaGuardOptions): () => void {
  const { maxRenderMs, job, totalFrames, pipelineStartMs, onTooSlow, now = Date.now } = options;
  if (!maxRenderMs || maxRenderMs <= 0) return () => {};
  const sampler = createRateSampler();
  const stop = () => clearInterval(timer);
  const timer = setInterval(() => {
    const done = job.framesRendered ?? 0;
    // Capture is complete: encode and assemble are not frame-driven, so the guard has nothing left to judge.
    if (done >= totalFrames) return stop();
    const at = now();
    const msPerFrame = sampler.observe(done, at);
    if (msPerFrame === undefined) return;
    const error = checkRenderEta("capture", {
      maxRenderMs,
      elapsedMs: at - pipelineStartMs,
      framesCompleted: done,
      totalFrames,
      msPerFrame,
    });
    if (!error) return;
    stop();
    onTooSlow(error);
  }, options.pollMs ?? POLL_MS);
  timer.unref?.();
  return stop;
}
