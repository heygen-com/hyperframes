/**
 * Immutable routing decision for the capture phase.
 *
 * The orchestrator used to carry the same decision in several mutable booleans
 * (`useStreamingEncode`, `useLayeredComposite`, `forceScreenshot`) plus worker
 * routing state. Keeping those values independently mutable made invalid
 * combinations representable during fallback. A CapturePlan is the single
 * value consumed by capture stages, and `replanAfterFailure` is the only
 * transition between variants.
 */

export type CapturePlanTarget = Readonly<{
  kind: "sdr_streaming" | "sdr_disk";
  workerCount: number;
  forceParallelStream: boolean;
}>;

export type CaptureRouting =
  | Readonly<{ kind: "default" }>
  | Readonly<{
      kind: "worker_inversion" | "parallel_router";
      state: "active" | "reverted";
      fallback: CapturePlanTarget;
      memoryExhaustionFallback: CapturePlanTarget;
    }>;

interface CapturePlanBase {
  readonly workerCount: number;
  readonly forceScreenshot: boolean;
  readonly forceParallelStream: boolean;
  readonly usePageSideCompositing: boolean;
  readonly hasHdrContent: boolean;
  readonly needsAlpha: boolean;
  readonly routing: CaptureRouting;
}

export interface SdrStreamingCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_streaming";
}

export interface SdrDiskCapturePlan extends CapturePlanBase {
  readonly kind: "sdr_disk";
  readonly forceParallelStream: false;
}

export interface HdrLayeredCapturePlan extends CapturePlanBase {
  readonly kind: "hdr_layered";
  readonly forceScreenshot: true;
  readonly forceParallelStream: false;
}

export type CapturePlan = SdrStreamingCapturePlan | SdrDiskCapturePlan | HdrLayeredCapturePlan;

export interface CreateCapturePlanInput {
  workerCount: number;
  forceScreenshot: boolean;
  forceParallelStream?: boolean;
  useStreamingEncode: boolean;
  useLayeredComposite: boolean;
  usePageSideCompositing: boolean;
  hasHdrContent: boolean;
  needsAlpha: boolean;
  routing?: CaptureRouting;
}

export type CapturePlanFailure =
  | Readonly<{ kind: "streaming_unavailable" }>
  | Readonly<{
      kind: "draw_element_verification";
      /**
       * Set by `drawElementVerificationFailure` only when the routing's
       * preferred fallback writes frames to disk and its precomputed
       * low-resource target does not. `false` means that disk route lacks
       * headroom, so `replanAfterFailure` takes the off-disk target instead.
       */
      diskFallbackAvailable?: boolean;
    }>
  | Readonly<{ kind: "draw_element_capture" }>
  | Readonly<{ kind: "capture_failure"; memoryExhaustion: boolean }>;

/**
 * Build the verification failure for `plan`, consulting disk headroom only
 * when the answer can change the fallback: a non-default routing (worker
 * inversion or parallel router) whose preferred fallback is `sdr_disk` while
 * its memory-exhaustion fallback is off-disk. Every other plan leaves the flag
 * `undefined` without calling `hasDiskFallbackHeadroom`.
 */
export function drawElementVerificationFailure(
  plan: CapturePlan,
  hasDiskFallbackHeadroom: () => boolean,
): CapturePlanFailure {
  const { routing } = plan;
  const needsHeadroom =
    routing.kind !== "default" &&
    routing.fallback.kind === "sdr_disk" &&
    routing.memoryExhaustionFallback.kind === "sdr_streaming";
  return {
    kind: "draw_element_verification",
    diskFallbackAvailable: needsHeadroom ? hasDiskFallbackHeadroom() : undefined,
  };
}

/**
 * Build the failure the streaming drain retries with, from the caller's
 * classification of the capture error. Only a drawElement self-verification
 * failure goes through `drawElementVerificationFailure` (and so may consult
 * disk headroom); every other failure is a plain capture failure and never
 * calls `hasDiskFallbackHeadroom`.
 */
export function streamingCaptureFailure(
  plan: CapturePlan,
  classification: Readonly<{ isVerifyError: boolean; isMemoryExhaustion: boolean }>,
  hasDiskFallbackHeadroom: () => boolean,
): CapturePlanFailure {
  return classification.isVerifyError
    ? drawElementVerificationFailure(plan, hasDiskFallbackHeadroom)
    : { kind: "capture_failure", memoryExhaustion: classification.isMemoryExhaustion };
}

function assertWorkerCount(workerCount: number): void {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error(`CapturePlan workerCount must be a positive integer; got ${workerCount}`);
  }
}

function freezeTarget(target: CapturePlanTarget): CapturePlanTarget {
  assertWorkerCount(target.workerCount);
  if (target.kind === "sdr_disk" && target.forceParallelStream) {
    throw new Error("CapturePlan disk fallback cannot force parallel streaming");
  }
  return Object.freeze({ ...target });
}

function freezeRouting(routing: CaptureRouting | undefined): CaptureRouting {
  if (!routing || routing.kind === "default") return Object.freeze({ kind: "default" });
  return Object.freeze({
    ...routing,
    fallback: freezeTarget(routing.fallback),
    memoryExhaustionFallback: freezeTarget(routing.memoryExhaustionFallback),
  });
}

export function createCapturePlan(input: CreateCapturePlanInput): CapturePlan {
  assertWorkerCount(input.workerCount);
  const base = {
    workerCount: input.workerCount,
    forceScreenshot: input.forceScreenshot || input.usePageSideCompositing,
    forceParallelStream: input.useStreamingEncode ? (input.forceParallelStream ?? false) : false,
    usePageSideCompositing: input.usePageSideCompositing,
    hasHdrContent: input.hasHdrContent,
    needsAlpha: input.needsAlpha,
    routing: freezeRouting(input.routing),
  };

  if (input.useLayeredComposite) {
    return Object.freeze({
      ...base,
      kind: "hdr_layered",
      forceScreenshot: true,
      forceParallelStream: false,
    });
  }
  if (input.useStreamingEncode) {
    return Object.freeze({ ...base, kind: "sdr_streaming" });
  }
  return Object.freeze({ ...base, kind: "sdr_disk", forceParallelStream: false });
}

function revertedRouting(routing: CaptureRouting): CaptureRouting {
  if (routing.kind === "default") return routing;
  return freezeRouting({ ...routing, state: "reverted" });
}

/** Pure, exhaustive capture fallback transition. The input plan is never mutated. */
export function replanAfterFailure(plan: CapturePlan, failure: CapturePlanFailure): CapturePlan {
  // Disk-path drawElement self-verification (parallel disk workers under the
  // explicit fast-capture opt-in) can also trip — the retry stays on the disk
  // path but forces the screenshot baseline.
  if (
    plan.kind === "sdr_disk" &&
    (failure.kind === "draw_element_verification" || failure.kind === "draw_element_capture")
  ) {
    return createCapturePlan({
      ...plan,
      forceScreenshot: true,
      useStreamingEncode: false,
      useLayeredComposite: false,
      forceParallelStream: false,
    });
  }
  if (plan.kind !== "sdr_streaming") {
    throw new Error(`Cannot apply ${failure.kind} to ${plan.kind} capture plan`);
  }

  if (failure.kind === "streaming_unavailable") {
    return createCapturePlan({
      ...plan,
      useStreamingEncode: false,
      useLayeredComposite: false,
      forceParallelStream: false,
    });
  }

  const isMemoryExhaustion = failure.kind === "capture_failure" && failure.memoryExhaustion;
  const diskFallbackUnavailable =
    failure.kind === "draw_element_verification" && failure.diskFallbackAvailable === false;
  // memoryExhaustionFallback is the routing decision's precomputed
  // low-resource target. It is also the viable choice when disk, rather than
  // RAM, makes the preferred fallback impossible — for any routing kind
  // (see drawElementVerificationFailure for when that flag is populated).
  const fallback =
    plan.routing.kind === "default"
      ? {
          kind: plan.kind,
          workerCount: isMemoryExhaustion ? 1 : plan.workerCount,
          forceParallelStream: false,
        }
      : isMemoryExhaustion || diskFallbackUnavailable
        ? plan.routing.memoryExhaustionFallback
        : plan.routing.fallback;
  return createCapturePlan({
    ...plan,
    workerCount: fallback.workerCount,
    forceScreenshot: true,
    forceParallelStream: fallback.forceParallelStream,
    useStreamingEncode: fallback.kind === "sdr_streaming",
    useLayeredComposite: false,
    routing: revertedRouting(plan.routing),
  });
}
